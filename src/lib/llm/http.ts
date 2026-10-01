import 'server-only';

import { LLMError, type ErrorSource, type LLMErrorCode } from '@/types/llm';

/**
 * Utilidades HTTP compartidas por los adaptadores.
 *
 * Todas las peticiones llevan timeout y traducen su fallo al error
 * normalizado `LLMError`, para que el resto de la aplicacion nunca vea
 * detalles concretos de Gemini o de Groq.
 */

export interface HttpCallOptions {
  provider: ErrorSource;
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function postJson<T>(options: HttpCallOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new LLMError({
        code: statusToCode(response.status),
        provider: options.provider,
        status: response.status,
        message: `HTTP ${response.status}: ${detail.slice(0, 400)}`,
        hint: hintForStatus(response.status, options.provider, response.headers.get('retry-after')),
      });
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof LLMError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      const aborted = options.signal?.aborted === true;
      throw new LLMError({
        code: aborted ? 'cancelled' : 'timeout',
        provider: options.provider,
        message: aborted
          ? 'Peticion cancelada por el usuario.'
          : `El proveedor no respondio en ${Math.round(options.timeoutMs / 1000)} s.`,
        cause: error,
      });
    }

    throw new LLMError({
      code: 'network',
      provider: options.provider,
      message: error instanceof Error ? error.message : 'Fallo de red desconocido.',
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(sin cuerpo)';
  }
}

function statusToCode(status: number): LLMErrorCode {
  if (status === 401 || status === 403) return 'auth';
  // 413 no es un limite de ritmo: la peticion excede el tamano maximo
  // permitido por peticion. Esperar no arregla nada, hay que acortarla.
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  if (status === 400 || status === 422) return 'invalid_response';
  return 'unknown';
}

function hintForStatus(status: number, provider: ErrorSource, retryAfter?: string | null): string | undefined {
  if (status === 401 || status === 403) {
    const envVar =
      provider === 'gemini'
        ? 'GEMINI_API_KEY'
        : provider === 'groq'
          ? 'GROQ_API_KEY'
          : provider === 'cloudflare'
            ? 'CLOUDFLARE_API_TOKEN'
            : null;
    return envVar
      ? `Revisa ${envVar} en tu archivo .env.local.`
      : 'El servidor rechazo la peticion por autenticacion.';
  }
  if (status === 429) {
    // Groq devuelve `retry-after` en segundos: decir cuanto hay que esperar
    // es mas util que un generico "espera un momento".
    const seconds = Number.parseInt(retryAfter ?? '', 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return `Cuota agotada. Vuelve a intentarlo en ${Math.ceil(seconds)} s o cambia de modelo.`;
    }
    return 'Has superado la cuota gratuita del proveedor. Espera o cambia de modelo.';
  }
  // 503 en Gemini y Groq significa casi siempre que ese modelo concreto esta
  // saturado, no que el servicio este caido: cambiar de modelo suele bastar.
  if (status === 503) return 'Ese modelo esta saturado ahora mismo. Reintenta en unos segundos o elige otro modelo.';
  if (status === 413) {
    return 'Reduce el numero de secciones del proyecto, o usa un proveedor con mayor limite por peticion.';
  }
  return undefined;
}
