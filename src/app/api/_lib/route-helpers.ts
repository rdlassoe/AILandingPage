import 'server-only';

import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

import { requireContext, type AppContext } from '@/lib/auth/session';
import { AppException, toAppError, toHttpStatus } from '@/lib/errors';
import { formatZodError } from '@/lib/validation/schemas';
import type { AppError } from '@/types/common';

/**
 * Utilidades compartidas por los route handlers.
 *
 * Objetivo: que ningun endpoint repita el mismo bloque de autenticacion,
 * validacion y traduccion de errores, y que el cliente reciba siempre la
 * misma forma de respuesta.
 */

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: AppError;
}

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, { status });
}

export function failure(error: unknown): NextResponse<ApiFailure> {
  const appError = toAppError(error);

  if (process.env.NODE_ENV !== 'production' && appError.detail) {
    console.error('[api]', appError.code, appError.detail);
  }

  // El detalle tecnico nunca viaja al cliente en produccion.
  const payload: AppError =
    process.env.NODE_ENV === 'production' ? { ...appError, detail: undefined } : appError;

  return NextResponse.json({ error: payload }, { status: toHttpStatus(appError.code) });
}

/** Ejecuta el handler con el contexto autenticado y traduce cualquier fallo. */
export async function withContext<T>(
  handler: (ctx: AppContext) => Promise<T>,
): Promise<NextResponse<ApiSuccess<T> | ApiFailure>> {
  try {
    const ctx = await requireContext();
    return ok(await handler(ctx));
  } catch (error) {
    return failure(error);
  }
}

/** Lee y valida el cuerpo JSON de la peticion. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppException({ code: 'validation', message: 'El cuerpo de la peticion no es JSON valido.' });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppException({
      code: 'validation',
      message: formatZodError(result.error),
      detail: JSON.stringify(result.error.issues),
    });
  }
  return result.data;
}

/** Lee un parametro de consulta acotado en longitud. */
export function searchParam(request: Request, name: string, maxLength = 120): string | undefined {
  const value = new URL(request.url).searchParams.get(name)?.trim();
  if (!value) return undefined;
  return value.slice(0, maxLength);
}
