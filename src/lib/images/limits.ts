/**
 * Limites en memoria de la generacion de imagenes.
 *
 *   - Presupuesto por usuario y hora: protege la cuota gratuita de Cloudflare
 *     (10 000 neuronas al dia, ~173 imagenes de 1024x1024) de un usuario que genere sin
 *     parar. Es un limitador de ventana deslizante, como `src/lib/rate-limit.ts`,
 *     pero con su propio cubo: las imagenes no deben gastar el limite de las
 *     llamadas al LLM ni al reves.
 *   - Freno de cuota (circuit breaker): tras un 429 de "cuota diaria agotada"
 *     no se vuelve a llamar a Cloudflare durante un rato. Seguir pidiendo solo
 *     gasta tiempo de la peticion del usuario, y la cuota es de la CUENTA de
 *     Cloudflare, no de un usuario: vale para todos.
 *
 * Como el limitador de texto, vive en memoria de proceso: con varias
 * instancias haria falta Redis o una tabla. Sin dependencias del proyecto
 * (los limites llegan como argumentos) para poder probarlo con Node.
 */

interface LimitsState {
  usage: Map<string, number[]>;
  quotaOpenUntil: number;
  /** Mientras no se pueda GUARDAR una imagen, generarla solo gasta neuronas en vano. */
  storageOpenUntil: number;
  storageHint: string | null;
}

const HOUR_MS = 3_600_000;

/** Sobrevive al hot reload del servidor de desarrollo, como la base local. */
const globalCache = globalThis as unknown as { __alsImageLimits?: LimitsState };
const state: LimitsState = (globalCache.__alsImageLimits ??= {
  usage: new Map(),
  quotaOpenUntil: 0,
  storageOpenUntil: 0,
  storageHint: null,
});
// Un estado creado por una version anterior del modulo (hot reload) no trae los campos nuevos.
state.storageOpenUntil ??= 0;
state.storageHint ??= null;

/**
 * Cuantas de las `wanted` imagenes puede generar `userId` ahora. Devuelve un
 * numero entre 0 y `wanted` y descuenta solo lo concedido.
 */
export function grantImageBudget(
  userId: string,
  wanted: number,
  options: { perHour: number; now?: number },
): number {
  const now = options.now ?? Date.now();
  const recent = (state.usage.get(userId) ?? []).filter((timestamp) => timestamp > now - HOUR_MS);
  const granted = Math.max(0, Math.min(wanted, options.perHour - recent.length));
  for (let index = 0; index < granted; index += 1) recent.push(now);
  state.usage.set(userId, recent);
  return granted;
}

/** Abre el freno de cuota durante `cooldownMs`. */
export function tripQuotaBreaker(cooldownMs: number, now = Date.now()): void {
  state.quotaOpenUntil = Math.max(state.quotaOpenUntil, now + cooldownMs);
}

/** Milisegundos que le quedan al freno abierto; 0 si esta cerrado. */
export function quotaBreakerRemainingMs(now = Date.now()): number {
  return Math.max(0, state.quotaOpenUntil - now);
}

/**
 * Abre el freno de almacenamiento durante `cooldownMs`: la ultima imagen se genero
 * pero no se pudo guardar (falta la tabla o el bucket, politicas, disco...).
 * Cada intento posterior gastaria ~58 neuronas de Cloudflare para tirar la imagen.
 * `hint` es la causa probable, para repetirla en los avisos mientras dure.
 */
export function tripStorageBreaker(cooldownMs: number, hint: string | null, now = Date.now()): void {
  state.storageOpenUntil = Math.max(state.storageOpenUntil, now + cooldownMs);
  state.storageHint = hint;
}

/** Estado del freno de almacenamiento: `remainingMs` es 0 si esta cerrado. */
export function storageBreaker(now = Date.now()): { remainingMs: number; hint: string | null } {
  return { remainingMs: Math.max(0, state.storageOpenUntil - now), hint: state.storageHint };
}

/** Solo para las pruebas. */
export function resetImageLimits(): void {
  state.usage.clear();
  state.quotaOpenUntil = 0;
  state.storageOpenUntil = 0;
  state.storageHint = null;
}
