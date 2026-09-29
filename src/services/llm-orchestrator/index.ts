import 'server-only';

import { env } from '@/lib/env';
import { resolveProvider } from '@/lib/llm/registry';
import { checkRateLimit } from '@/lib/rate-limit';
import { stableHash } from '@/lib/utils';
import { DEFAULT_GENERATION_CONFIG, LLMError, type LLMResponse, type ProviderId } from '@/types/llm';
import type { OrchestratorRequest, OrchestratorResult } from '@/types/services';

/**
 * LLM Orchestrator
 *
 * Unico punto por el que la aplicacion habla con un modelo. Se encarga de:
 *  - elegir proveedor y modelo (con degradacion al modo demo);
 *  - aplicar el limitador de uso antes de gastar cuota;
 *  - fijar timeout y permitir cancelacion;
 *  - reintentar una sola vez ante fallos transitorios (nunca en bucle);
 *  - normalizar la respuesta y calcular la clave de cache.
 */

export interface OrchestratorOutcome extends OrchestratorResult {
  /** true si se pidio un proveedor sin configurar y se uso el modo demo. */
  fellBackToMock: boolean;
  requestedProvider: ProviderId;
}

/** Fallos que justifican exactamente un reintento. */
const RETRYABLE: ReadonlySet<string> = new Set(['server', 'network', 'timeout']);

export function computeCacheKey(input: {
  system?: string;
  prompt: string;
  providerId: ProviderId;
  model: string;
  temperature: number;
}): string {
  return stableHash(
    [input.providerId, input.model, input.temperature.toFixed(2), input.system ?? '', input.prompt].join('\u0000'),
  );
}

export async function runLLM(request: OrchestratorRequest): Promise<OrchestratorOutcome> {
  const { provider, fellBackToMock, requested } = resolveProvider(request.providerId);
  const model = pickModel(request.model, provider.defaultModel);
  const config = { ...DEFAULT_GENERATION_CONFIG, ...request.config };

  const cacheKey = computeCacheKey({
    system: request.system,
    prompt: request.prompt,
    providerId: provider.id,
    model,
    temperature: config.temperature,
  });

  // El limitador protege la cuota de los proveedores externos y se aplica
  // antes de cualquier llamada de red. El modo demo no consume cuota de nadie,
  // asi que no se limita: de lo contrario el enfriamiento bloquearia pasos
  // encadenados del flujo (generar y auditar seguidos) sin ninguna ganancia.
  // Ollama corre en la maquina del usuario: tampoco consume cuota de un
  // tercero, asi que se exime por el mismo motivo.
  if (provider.id !== 'mock' && provider.id !== 'ollama') {
    checkRateLimit(request.ownerId);
  }

  const response = await callWithSingleRetry(async () =>
    provider.generate({
      system: request.system,
      prompt: request.prompt,
      model,
      config,
      responseFormat: request.responseFormat,
      timeoutMs: request.timeoutMs ?? env.llm.timeoutMs,
      signal: request.signal,
    }),
  );

  return normalize(response, cacheKey, fellBackToMock, requested);
}

async function callWithSingleRetry(call: () => Promise<LLMResponse>): Promise<LLMResponse> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof LLMError && RETRYABLE.has(error.code)) {
      // Un unico reintento. Nunca en bucle.
      //
      // La espera se ajusta al tipo de fallo: un 503 suele ser un modelo
      // saturado y 1 segundo no cambia nada, mientras que un corte de red se
      // recupera enseguida. Cinco segundos es el maximo tolerable sin que el
      // usuario crea que la aplicacion se ha colgado.
      const waitMs = error.code === 'server' ? 5_000 : 1_500;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return call();
    }
    throw error;
  }
}

function normalize(
  response: LLMResponse,
  cacheKey: string,
  fellBackToMock: boolean,
  requestedProvider: ProviderId,
): OrchestratorOutcome {
  return {
    text: response.text,
    providerId: response.provider,
    model: response.model,
    latencyMs: response.latencyMs,
    isMock: response.isMock,
    servedFromCache: false,
    cacheKey,
    inputTokens: response.usage.inputTokens ?? null,
    outputTokens: response.usage.outputTokens ?? null,
    fellBackToMock,
    requestedProvider,
  };
}

/**
 * Antes esto exigia que `requested` apareciera en el catalogo ESTATICO del
 * proveedor (`provider.models`), y si no coincidia exactamente caia al
 * modelo por defecto EN SILENCIO. Para Gemini/Groq el catalogo es completo
 * asi que casi nunca se notaba, pero para Ollama el catalogo real depende de
 * lo que cada maquina tenga descargado (`listAvailableModels()`, no
 * `provider.models`): pedir un modelo instalado que no estuviera en la lista
 * de referencia (p.ej. "llama3.1:8b" en vez de "llama3.1") terminaba
 * ejecutando el modelo por defecto sin ningun aviso.
 *
 * Cada adaptador ya hace `request.model ?? this.defaultModel` por su cuenta,
 * y un modelo desconocido para el proveedor es la API quien lo valida (ver
 * `maxOutputFor`) — asi que aqui basta con lo mismo: confiar en el modelo
 * pedido si viene, sin comprobarlo contra ningun catalogo.
 */
function pickModel(requested: string | undefined, fallback: string): string {
  const trimmed = requested?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Ejecuta un prompt que debe devolver JSON y lo interpreta.
 * Tolera que el modelo envuelva el JSON en un bloque de markdown.
 */
export async function runLLMJson<T>(request: OrchestratorRequest): Promise<{ data: T; outcome: OrchestratorOutcome }> {
  const outcome = await runLLM({ ...request, responseFormat: 'json' });
  const data = parseJsonResponse<T>(outcome.text, outcome.providerId);
  return { data, outcome };
}

export function parseJsonResponse<T>(text: string, provider: ProviderId): T {
  const candidates = [text.trim(), stripCodeFence(text), extractFirstJsonObject(text)];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // se prueba el siguiente candidato
    }
  }

  throw new LLMError({
    code: 'invalid_response',
    provider,
    message: 'La respuesta del modelo no contiene un JSON valido.',
  });
}

function stripCodeFence(text: string): string | null {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return match?.[1]?.trim() ?? null;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
