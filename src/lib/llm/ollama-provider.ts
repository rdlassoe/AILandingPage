import 'server-only';

import { postJson } from './http';
import { OLLAMA_MODELS, maxOutputFor } from './models';
import { env } from '@/lib/env';
import {
  DEFAULT_GENERATION_CONFIG,
  LLMError,
  type FinishReason,
  type LLMModelInfo,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type ProviderHealth,
} from '@/types/llm';

/**
 * Ollama corre en local (por defecto `http://localhost:11434`) y expone un
 * endpoint compatible con la API de OpenAI, asi que este adaptador tiene la
 * misma forma que `groq-provider.ts`. La diferencia real es que no hay clave
 * ni cuota: lo que falla es la conexion (Ollama no esta arrancado) o el
 * modelo pedido (no se ha descargado con `ollama pull`).
 */

/** Forma parcial de la respuesta compatible con OpenAI que expone Ollama. */
interface OllamaChatResponse {
  choices?: Array<{
    // Los modelos "thinking" (p.ej. la familia qwen3) devuelven ademas
    // `reasoning`: el razonamiento previo, que consume el mismo presupuesto
    // de tokens de salida que `content`. Verificado el 2026-09-23 contra una
    // instancia local: con un limite ajustado, `content` llega vacio y
    // `finish_reason` es `length`, exactamente el mismo caso ya conocido con
    // los modelos de razonamiento de Gemini.
    message?: { content?: string; reasoning?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Forma parcial de `GET /api/tags`, la API nativa (no la compatible con OpenAI). */
interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    details?: {
      parameter_size?: string;
      quantization_level?: string;
      context_length?: number;
    };
  }>;
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama' as const;
  readonly label = 'Ollama (local)';
  readonly docsUrl = 'https://ollama.com/download';
  // Sin variable de entorno que "habilite" el proveedor: no requiere clave,
  // igual que el modo demo. La disponibilidad real se ve al probar conexion.
  readonly envKey = null;
  readonly models = OLLAMA_MODELS;

  get defaultModel(): string {
    return env.ollama.defaultModel || 'qwen3:8b';
  }

  isConfigured(): boolean {
    return true;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.defaultModel;
    const config = { ...DEFAULT_GENERATION_CONFIG, ...request.config };
    const started = Date.now();

    const limit = maxOutputFor(this.models, model);
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    let data: OllamaChatResponse;
    try {
      data = await postJson<OllamaChatResponse>({
        provider: this.id,
        url: `${env.ollama.baseUrl}/v1/chat/completions`,
        body: {
          model,
          messages,
          temperature: config.temperature,
          top_p: config.topP,
          max_tokens: limit === null ? config.maxOutputTokens : Math.min(config.maxOutputTokens, limit),
          stream: false,
          ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        },
        timeoutMs: request.timeoutMs ?? env.llm.timeoutMs,
        signal: request.signal,
      });
    } catch (error) {
      throw translateConnectionError(error, model);
    }

    const choice = data.choices?.[0];
    const text = (choice?.message?.content ?? '').trim();

    if (!text) {
      // Los modelos "thinking" (qwen3 y similares) gastan parte del
      // presupuesto de salida razonando antes de escribir la respuesta. Si
      // se agota antes de llegar al texto final, `content` llega vacio con
      // `finish_reason: "length"` y un 200: no es un fallo de conexion.
      const exhausted = choice?.finish_reason === 'length' && !!choice?.message?.reasoning;
      throw new LLMError({
        code: 'invalid_response',
        provider: this.id,
        message: exhausted
          ? `${model} agoto el presupuesto de salida razonando y no llego a escribir la respuesta.`
          : `${model} devolvio una respuesta vacia.`,
        hint: exhausted ? 'Sube maxOutputTokens o elige un modelo que no razone explicitamente.' : undefined,
      });
    }

    return {
      text,
      provider: this.id,
      model,
      latencyMs: Date.now() - started,
      finishReason: normalizeFinishReason(choice?.finish_reason),
      isMock: false,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }

  async testConnection(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = Date.now();
    try {
      const response = await this.generate({
        prompt: 'Responde unicamente con la palabra: ok',
        // 512 y no un valor menor: los modelos "thinking" como qwen3 gastan
        // parte del presupuesto pensando (~200 tokens medidos para "ok") y
        // con un tope ajustado la respuesta llega vacia aunque Ollama este
        // funcionando perfectamente.
        config: { maxOutputTokens: 512, temperature: 0 },
        timeoutMs: 30_000,
      });
      return {
        provider: this.id,
        status: 'connected',
        message: `Conexion correcta con ${response.model}.`,
        latencyMs: Date.now() - started,
        model: response.model,
        checkedAt,
      };
    } catch (error) {
      return {
        provider: this.id,
        status: 'error',
        message: error instanceof Error ? error.message : 'Error desconocido.',
        latencyMs: Date.now() - started,
        checkedAt,
      };
    }
  }

  /**
   * A diferencia de Gemini/Groq, el catalogo real no es fijo: depende de que
   * modelos haya descargado esta maquina. Se consulta `GET /api/tags` (API
   * nativa de Ollama, no la compatible con OpenAI) y, si Ollama no responde,
   * se deja que el llamador use el catalogo estatico como referencia.
   */
  async listAvailableModels(): Promise<LLMModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    try {
      const response = await fetch(`${env.ollama.baseUrl}/api/tags`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) return this.models;

      const data = (await response.json()) as OllamaTagsResponse;
      const installed = data.models ?? [];
      if (installed.length === 0) return this.models;

      return installed.map((model) => {
        const contextLength = model.details?.context_length ?? 8_192;
        return {
          id: model.name,
          label: model.name,
          contextWindow: contextLength,
          maxOutputTokens: Math.min(contextLength, 32_768),
          goodForLongOutput: contextLength >= 16_000,
          description: [model.details?.parameter_size, model.details?.quantization_level]
            .filter(Boolean)
            .join(' · ') || 'Modelo instalado localmente.',
        };
      });
    } catch {
      // Ollama no esta arrancado o no responde a tiempo: no es un error que
      // deba romper la pantalla de Ajustes, simplemente no hay nada mejor
      // que ofrecer que el catalogo estatico.
      return this.models;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * `postJson` traduce fallos HTTP y de red a `LLMError`, pero el mensaje
 * generico de "network" no dice nada util cuando la causa casi siempre es
 * "Ollama no esta arrancado". Se afina aqui en lugar de en `http.ts`, que es
 * compartido con proveedores en la nube donde ese diagnostico no aplica.
 */
function translateConnectionError(error: unknown, model: string): LLMError {
  if (error instanceof LLMError && error.code === 'network') {
    return new LLMError({
      code: 'network',
      provider: 'ollama',
      message: `No se pudo contactar con Ollama en ${env.ollama.baseUrl}.`,
      hint: `Comprueba que Ollama esta en ejecucion y que has descargado el modelo con "ollama pull ${model}".`,
      cause: error,
    });
  }
  if (error instanceof LLMError) return error;
  return new LLMError({
    code: 'unknown',
    provider: 'ollama',
    message: error instanceof Error ? error.message : 'Error desconocido al hablar con Ollama.',
    cause: error,
  });
}

function normalizeFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}
