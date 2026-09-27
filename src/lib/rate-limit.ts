import 'server-only';

import { env } from '@/lib/env';
import { AppException } from '@/lib/errors';

/**
 * Limitador de uso por usuario.
 *
 * Implementa ventana deslizante + enfriamiento minimo entre peticiones.
 * Aunque los proveedores tengan capa gratuita, la aplicacion nunca debe
 * disparar llamadas sin control: esto protege la cuota del usuario y evita
 * bucles de reintento.
 *
 * Nota: el estado vive en memoria del proceso. En un despliegue con varias
 * instancias habria que moverlo a Redis o a una tabla de Postgres; la
 * interfaz de este modulo no cambiaria.
 */

interface UsageRecord {
  timestamps: number[];
  lastRequestAt: number;
}

const globalCache = globalThis as unknown as { __alsRateLimit?: Map<string, UsageRecord> };
const usage: Map<string, UsageRecord> = globalCache.__alsRateLimit ?? new Map();
globalCache.__alsRateLimit = usage;

export interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetsInMs: number;
}

export function checkRateLimit(userId: string): RateLimitStatus {
  const now = Date.now();
  const record = usage.get(userId) ?? { timestamps: [], lastRequestAt: 0 };

  const windowStart = now - env.rateLimit.windowMs;
  const recent = record.timestamps.filter((ts) => ts > windowStart);

  const sinceLast = now - record.lastRequestAt;
  if (record.lastRequestAt > 0 && sinceLast < env.rateLimit.cooldownMs) {
    const waitSeconds = Math.ceil((env.rateLimit.cooldownMs - sinceLast) / 1000);
    throw new AppException({
      code: 'rate_limited',
      message: `Espera ${waitSeconds} ${waitSeconds === 1 ? 'segundo' : 'segundos'} antes de volver a generar.`,
      retryable: true,
    });
  }

  if (recent.length >= env.rateLimit.maxRequests) {
    const oldest = recent[0] ?? now;
    const minutes = Math.ceil((oldest + env.rateLimit.windowMs - now) / 60_000);
    throw new AppException({
      code: 'rate_limited',
      message: `Has alcanzado el limite de ${env.rateLimit.maxRequests} generaciones por hora. Vuelve a intentarlo en ${minutes} min.`,
      hint: 'Puedes ajustar RATE_LIMIT_MAX_REQUESTS en las variables de entorno.',
      retryable: true,
    });
  }

  recent.push(now);
  usage.set(userId, { timestamps: recent, lastRequestAt: now });

  return {
    remaining: Math.max(0, env.rateLimit.maxRequests - recent.length),
    limit: env.rateLimit.maxRequests,
    resetsInMs: env.rateLimit.windowMs,
  };
}

export function peekRateLimit(userId: string): RateLimitStatus {
  const now = Date.now();
  const record = usage.get(userId);
  const recent = (record?.timestamps ?? []).filter((ts) => ts > now - env.rateLimit.windowMs);
  return {
    remaining: Math.max(0, env.rateLimit.maxRequests - recent.length),
    limit: env.rateLimit.maxRequests,
    resetsInMs: env.rateLimit.windowMs,
  };
}
