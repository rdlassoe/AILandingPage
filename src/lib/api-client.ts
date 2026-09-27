import type { AppError } from '@/types/common';

/**
 * Cliente HTTP del navegador.
 * Normaliza la forma de respuesta de la API para que los componentes no
 * tengan que repetir el manejo de errores ni exponer detalles tecnicos.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

interface ApiEnvelope<T> {
  data?: T;
  error?: AppError;
}

const NETWORK_ERROR: AppError = {
  code: 'unknown',
  message: 'No pudimos conectar con el servidor. Revisa tu conexion e intentalo de nuevo.',
  retryable: true,
};

async function request<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;

    if (!response.ok) {
      return { ok: false, error: payload.error ?? NETWORK_ERROR };
    }
    if (payload.data === undefined) {
      return { ok: false, error: { code: 'unknown', message: 'Respuesta vacia del servidor.' } };
    }
    return { ok: true, data: payload.data };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: { code: 'unknown', message: 'Operacion cancelada.' } };
    }
    return { ok: false, error: NETWORK_ERROR };
  }
}

export function apiGet<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>(url, { method: 'GET', signal });
}

export function apiPost<T>(url: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export function apiPatch<T>(url: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export function apiDelete<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>(url, { method: 'DELETE', signal });
}
