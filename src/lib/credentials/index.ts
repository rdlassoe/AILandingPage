import 'server-only';

import { CredentialsCryptoError, decryptCredentials, encryptCredentials, getMasterKey, type KeySource } from './crypto';
import type { DataStore } from '@/lib/data/types';
import { env, envCredentials } from '@/lib/env';
import { AppException } from '@/lib/errors';
import type { EffectiveCredentials } from '@/types/llm';

/**
 * Credenciales de los proveedores, por usuario.
 *
 * ANTES las claves solo podian vivir en las variables de entorno del servidor y la pantalla
 * de Ajustes no tenia campos para escribirlas. AHORA cada usuario puede guardar las suyas
 * desde Ajustes. Decisiones:
 *
 *  - **Por usuario, no de la app.** Si cualquier cuenta pudiera cambiar una clave global, en
 *    un despliegue con registro abierto un desconocido sustituiria la del dueno. Las del
 *    entorno siguen existiendo como respaldo compartido: la clave guardada por un usuario
 *    gana a la del entorno, y sin ella se usa esta.
 *  - **Cifradas en reposo** (`crypto.ts`), con el id del usuario como dato autenticado. En
 *    la base de datos o en `db.json` solo hay texto cifrado.
 *  - **Nunca vuelven al cliente.** El estado que ve la interfaz solo trae de donde sale cada
 *    valor y los cuatro ultimos caracteres.
 *  - **La URL de Ollama solo se puede cambiar en modo local.** El servidor hace la peticion:
 *    en un despliegue compartido, dejar que un usuario elija la URL seria una puerta para
 *    que el servidor hable con direcciones internas (SSRF). Las URLs de Gemini, Groq y
 *    Cloudflare estan fijas en el codigo.
 */

export const CREDENTIAL_FIELDS = [
  'geminiApiKey',
  'groqApiKey',
  'ollamaBaseUrl',
  'cloudflareAccountId',
  'cloudflareApiToken',
] as const;

export type CredentialField = (typeof CREDENTIAL_FIELDS)[number];
export type StoredCredentials = Partial<Record<CredentialField, string>>;
/** `null` (o cadena vacia) borra el campo; ausente lo deja como esta. */
export type CredentialsPatch = Partial<Record<CredentialField, string | null>>;

type CredentialsStore = Pick<DataStore, 'getCredentialsBlob' | 'saveCredentialsBlob'>;

export type CredentialSource = 'settings' | 'env' | 'none';

export interface FieldStatus {
  source: CredentialSource;
  /** Pista para reconocerla (ultimos 4 caracteres); nunca el valor. La URL de Ollama no es secreta. */
  hint: string | null;
}

export interface CredentialsStatus {
  fields: Record<CredentialField, FieldStatus>;
  storage: {
    /** Se puede guardar: hay clave maestra y la base de datos responde. */
    available: boolean;
    keySource: KeySource | null;
    /** Por que no se puede guardar o leer, si es el caso (apto para el usuario). */
    problem: string | null;
    /** Hay credenciales guardadas pero no se pueden descifrar. */
    unreadable: boolean;
    ollamaUrlEditable: boolean;
  };
}

export function allowsUserOllamaUrl(supabaseEnabled: boolean = env.supabase.enabled): boolean {
  return !supabaseEnabled;
}

/* ----------------------------- validacion ----------------------------- */

export type NormalizedValue = { ok: true; value: string } | { ok: false; message: string };

const SECRET = /^[\x21-\x7e]{8,400}$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

const LABELS: Record<CredentialField, string> = {
  geminiApiKey: 'La clave de Gemini',
  groqApiKey: 'La clave de Groq',
  ollamaBaseUrl: 'La URL de Ollama',
  cloudflareAccountId: 'El Account ID de Cloudflare',
  cloudflareApiToken: 'El token de Cloudflare',
};

/**
 * Valida y normaliza un valor. Lo que no pase aqui no se guarda: una clave con espacios o
 * saltos de linea acabaria en una cabecera HTTP.
 */
export function normalizeCredentialValue(
  field: CredentialField,
  raw: string,
  options: { supabaseEnabled?: boolean } = {},
): NormalizedValue {
  const value = raw.trim();

  if (field === 'cloudflareAccountId') {
    return ACCOUNT_ID.test(value)
      ? { ok: true, value: value.toLowerCase() }
      : { ok: false, message: `${LABELS[field]} son 32 caracteres hexadecimales (lo ves en el panel de Cloudflare).` };
  }

  if (field === 'ollamaBaseUrl') {
    if (!allowsUserOllamaUrl(options.supabaseEnabled)) {
      return {
        ok: false,
        message: 'La URL de Ollama solo se puede cambiar en modo local; en un despliegue compartido se define con OLLAMA_BASE_URL.',
      };
    }
    if (value.length > 200) return { ok: false, message: `${LABELS[field]} es demasiado larga.` };
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { ok: false, message: `${LABELS[field]} no es valida (por ejemplo http://localhost:11434).` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, message: `${LABELS[field]} debe empezar por http:// o https://.` };
    }
    if (url.username || url.password || url.search || url.hash) {
      return { ok: false, message: `${LABELS[field]} no puede llevar usuario, contrasena, parametros ni fragmento.` };
    }
    return { ok: true, value: `${url.origin}${url.pathname}`.replace(/\/+$/, '') };
  }

  return SECRET.test(value)
    ? { ok: true, value }
    : { ok: false, message: `${LABELS[field]} debe tener entre 8 y 400 caracteres, sin espacios ni saltos de linea.` };
}

/* ----------------------------- lectura ----------------------------- */

interface StoredState {
  stored: StoredCredentials;
  unreadable: boolean;
  /** Fallo de lectura (la columna no existe, la base no responde...). */
  problem: string | null;
}

function sanitize(parsed: unknown): StoredCredentials {
  const out: StoredCredentials = {};
  if (parsed && typeof parsed === 'object') {
    for (const field of CREDENTIAL_FIELDS) {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim().length > 0) out[field] = value.trim();
    }
  }
  return out;
}

function messageOf(error: unknown): string {
  if (error instanceof AppException) return error.hint ? `${error.message} ${error.hint}` : error.message;
  return error instanceof Error ? error.message : 'Error desconocido.';
}

/**
 * Lee y descifra lo que el usuario guardo. NUNCA lanza: esto se ejecuta en cada llamada a un
 * modelo y en cada pagina, y un fallo aqui (p. ej. una base de datos a la que aun no se le
 * anadio la columna) no puede romper la aplicacion: se usa el entorno y el motivo se ve en
 * Ajustes.
 */
async function loadStored(store: CredentialsStore, userId: string): Promise<StoredState> {
  let blob: string | null;
  try {
    blob = await store.getCredentialsBlob(userId);
  } catch (error) {
    return { stored: {}, unreadable: false, problem: messageOf(error) };
  }
  if (!blob) return { stored: {}, unreadable: false, problem: null };

  try {
    return { stored: sanitize(JSON.parse(await decryptCredentials(blob, userId))), unreadable: false, problem: null };
  } catch (error) {
    return {
      stored: {},
      unreadable: true,
      problem: error instanceof CredentialsCryptoError ? error.message : 'No se pudieron leer las credenciales guardadas.',
    };
  }
}

function merge(stored: StoredCredentials, fromEnv: EffectiveCredentials, supabaseEnabled: boolean): EffectiveCredentials {
  const pick = (field: CredentialField): string => stored[field]?.trim() || fromEnv[field];
  return {
    geminiApiKey: pick('geminiApiKey'),
    groqApiKey: pick('groqApiKey'),
    cloudflareAccountId: pick('cloudflareAccountId'),
    cloudflareApiToken: pick('cloudflareApiToken'),
    // En modo compartido se ignora lo guardado aunque exista (defensa en profundidad contra SSRF).
    ollamaBaseUrl: allowsUserOllamaUrl(supabaseEnabled) ? pick('ollamaBaseUrl') : fromEnv.ollamaBaseUrl,
  };
}

/**
 * Credenciales efectivas de un usuario: las suyas y, para lo que no tenga, las del entorno.
 * No lanza nunca.
 */
export async function resolveCredentials(store: CredentialsStore, userId: string): Promise<EffectiveCredentials> {
  const { stored } = await loadStored(store, userId);
  return merge(stored, envCredentials(), env.supabase.enabled);
}

/* ----------------------------- estado para la interfaz ----------------------------- */

function mask(field: CredentialField, value: string): string {
  if (field === 'ollamaBaseUrl') return value;
  return value.length >= 12 ? `••••${value.slice(-4)}` : '••••';
}

export async function getCredentialsStatus(store: CredentialsStore, userId: string): Promise<CredentialsStatus> {
  const state = await loadStored(store, userId);
  const fromEnv = envCredentials();
  const ollamaUrlEditable = allowsUserOllamaUrl();

  const fields = {} as Record<CredentialField, FieldStatus>;
  for (const field of CREDENTIAL_FIELDS) {
    const own = field === 'ollamaBaseUrl' && !ollamaUrlEditable ? undefined : state.stored[field];
    // Para Ollama el entorno siempre trae un valor (la URL por defecto): no cuenta como "configurada".
    const envValue = field === 'ollamaBaseUrl' && !env.ollama.explicit ? '' : fromEnv[field];
    if (own) fields[field] = { source: 'settings', hint: mask(field, own) };
    else if (envValue) fields[field] = { source: 'env', hint: mask(field, envValue) };
    else fields[field] = { source: 'none', hint: null };
  }

  let keySource: KeySource | null = null;
  let keyProblem: string | null = null;
  try {
    keySource = (await getMasterKey()).source;
  } catch (error) {
    keyProblem = error instanceof CredentialsCryptoError ? error.message : 'No hay clave de cifrado disponible.';
  }

  const problem = keyProblem ?? state.problem;
  return {
    fields,
    storage: {
      available: keySource !== null && (state.problem === null || state.unreadable),
      keySource,
      problem,
      unreadable: state.unreadable,
      ollamaUrlEditable,
    },
  };
}

/* ----------------------------- escritura ----------------------------- */

/**
 * Aplica un cambio parcial y devuelve el estado resultante. Valida todo antes de tocar nada:
 * si un valor no es valido, no se guarda ninguno.
 */
export async function saveCredentials(
  store: CredentialsStore,
  userId: string,
  patch: CredentialsPatch,
): Promise<CredentialsStatus> {
  const changes: Array<[CredentialField, string | null]> = [];
  for (const field of CREDENTIAL_FIELDS) {
    const raw = patch[field];
    if (raw === undefined) continue;
    if (raw === null || raw.trim() === '') {
      changes.push([field, null]);
      continue;
    }
    const result = normalizeCredentialValue(field, raw);
    if (!result.ok) {
      throw new AppException({
        code: field === 'ollamaBaseUrl' && !allowsUserOllamaUrl() ? 'forbidden' : 'validation',
        message: result.message,
      });
    }
    changes.push([field, result.value]);
  }

  // Lectura estricta: si la base de datos no puede leerse, el error llega tal cual al usuario.
  let current: StoredCredentials = {};
  const existing = await store.getCredentialsBlob(userId);
  if (existing) {
    try {
      current = sanitize(JSON.parse(await decryptCredentials(existing, userId)));
    } catch (error) {
      // Lo guardado no se puede descifrar: no hay nada que conservar, se empieza de cero.
      const unreadable = error instanceof SyntaxError || (error instanceof CredentialsCryptoError && error.code !== 'no_key');
      if (!unreadable) throw toStorageError(error);
    }
  }

  const next: StoredCredentials = { ...current };
  for (const [field, value] of changes) {
    if (value === null) delete next[field];
    else next[field] = value;
  }

  if (Object.keys(next).length === 0) {
    await store.saveCredentialsBlob(userId, null);
  } else {
    let blob: string;
    try {
      blob = await encryptCredentials(JSON.stringify(next), userId);
    } catch (error) {
      throw toStorageError(error);
    }
    await store.saveCredentialsBlob(userId, blob);
  }

  return getCredentialsStatus(store, userId);
}

/** Borra todas las credenciales guardadas del usuario (las del entorno no se tocan). */
export async function clearCredentials(store: CredentialsStore, userId: string): Promise<CredentialsStatus> {
  await store.saveCredentialsBlob(userId, null);
  return getCredentialsStatus(store, userId);
}

function toStorageError(error: unknown): AppException {
  if (error instanceof AppException) return error;
  const message =
    error instanceof CredentialsCryptoError && error.code === 'no_key'
      ? error.message
      : 'No pudimos cifrar tus credenciales.';
  return new AppException({
    code: 'storage_error',
    message: 'No se pueden guardar claves desde Ajustes ahora mismo.',
    hint: message,
    detail: error instanceof Error ? error.message : undefined,
  });
}
