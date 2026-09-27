/**
 * Tipos base compartidos por toda la aplicacion.
 */

/** Estado de cualquier operacion asincrona expuesta en la UI. */
export type AsyncState = 'idle' | 'loading' | 'success' | 'error' | 'empty';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Resultado uniforme devuelto por los servicios de dominio. */
export type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export interface AppError {
  code: AppErrorCode;
  /** Mensaje apto para mostrar directamente al usuario final. */
  message: string;
  /** Detalle tecnico. Solo para logs / modo desarrollo. */
  detail?: string;
  /** Sugerencia accionable ("Configura GEMINI_API_KEY en .env.local"). */
  hint?: string;
  retryable?: boolean;
}

export type AppErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'provider_not_configured'
  | 'provider_error'
  | 'timeout'
  | 'invalid_output'
  | 'storage_error'
  | 'unknown';

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });
export const fail = <E = AppError>(error: E): Result<never, E> => ({ ok: false, error });

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}
