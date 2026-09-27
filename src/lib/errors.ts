import type { AppError, AppErrorCode } from '@/types/common';
import { LLMError } from '@/types/llm';

/**
 * Excepcion de dominio con mensaje apto para el usuario final.
 * Los route handlers la traducen a una respuesta HTTP con `toHttpStatus`.
 */
export class AppException extends Error {
  readonly code: AppErrorCode;
  readonly detail?: string;
  readonly hint?: string;
  readonly retryable: boolean;

  constructor(params: {
    code: AppErrorCode;
    message: string;
    detail?: string;
    hint?: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = 'AppException';
    this.code = params.code;
    this.detail = params.detail;
    this.hint = params.hint;
    this.retryable = params.retryable ?? false;
  }

  toAppError(): AppError {
    return {
      code: this.code,
      message: this.message,
      detail: this.detail,
      hint: this.hint,
      retryable: this.retryable,
    };
  }
}

export const notFound = (what: string) =>
  new AppException({ code: 'not_found', message: `No encontramos ${what}.` });

export const unauthorized = () =>
  new AppException({
    code: 'unauthorized',
    message: 'Necesitas iniciar sesion para continuar.',
  });

export const forbidden = () =>
  new AppException({
    code: 'forbidden',
    message: 'Este recurso pertenece a otra cuenta.',
  });

export const validationError = (message: string, detail?: string) =>
  new AppException({ code: 'validation', message, detail });

/** Mensajes humanos para cada fallo de proveedor LLM. */
const LLM_MESSAGES: Record<LLMError['code'], { message: string; code: AppErrorCode }> = {
  not_configured: {
    message: 'Ese proveedor todavia no tiene una clave API configurada.',
    code: 'provider_not_configured',
  },
  auth: {
    message: 'La clave API del proveedor no es valida o ha caducado.',
    code: 'provider_error',
  },
  too_large: {
    message: 'La peticion supera el tamano maximo que admite ese modelo. Reintentar no servira: hay que acortarla.',
    code: 'validation',
  },
  rate_limited: {
    message: 'El proveedor ha alcanzado su limite de peticiones. Espera un momento y vuelve a intentarlo.',
    code: 'rate_limited',
  },
  timeout: {
    message: 'El modelo tardo demasiado en responder. Prueba con un prompt mas corto o con otro modelo.',
    code: 'timeout',
  },
  network: {
    message: 'No pudimos contactar con el proveedor. Revisa tu conexion.',
    code: 'provider_error',
  },
  server: {
    message: 'El modelo esta saturado o el proveedor tiene problemas. Reintenta o cambia de modelo.',
    code: 'provider_error',
  },
  invalid_response: {
    message: 'El modelo devolvio una respuesta que no pudimos interpretar.',
    code: 'invalid_output',
  },
  cancelled: {
    message: 'La generacion se cancelo.',
    code: 'provider_error',
  },
  content_filter: {
    message: 'El proveedor bloqueo la respuesta por sus filtros de contenido.',
    code: 'provider_error',
  },
  unknown: {
    message: 'Algo fallo al generar. Vuelve a intentarlo.',
    code: 'provider_error',
  },
};

/** Convierte cualquier excepcion en un `AppError` presentable. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppException) return error.toAppError();

  if (error instanceof LLMError) {
    const mapped = LLM_MESSAGES[error.code];
    return {
      code: mapped.code,
      message: mapped.message,
      detail: error.message,
      hint: error.hint,
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'unknown',
      message: 'Se produjo un error inesperado.',
      detail: error.message,
      retryable: false,
    };
  }

  return { code: 'unknown', message: 'Se produjo un error inesperado.', retryable: false };
}

export function toHttpStatus(code: AppErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'validation':
      return 422;
    case 'conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'timeout':
      return 504;
    case 'provider_not_configured':
      return 503;
    case 'provider_error':
      return 502;
    case 'invalid_output':
      return 502;
    case 'storage_error':
      return 500;
    default:
      return 500;
  }
}
