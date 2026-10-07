import 'server-only';

import { normalizeSupabaseUrl } from '@/lib/supabase/url';
import type { EffectiveCredentials, ProviderId } from '@/types/llm';

/**
 * Lectura centralizada de variables de entorno.
 *
 * Este modulo esta marcado como `server-only`: si algun componente de cliente
 * lo importa por error, el build falla en lugar de filtrar claves al bundle.
 */

// Declarada ANTES de `env`: `normalizeCloudflareBaseUrl` la usa al evaluar el objeto, y una
// `const` posterior daria "Cannot access before initialization" al arrancar sin la variable.
const CLOUDFLARE_DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';

function str(value: string | undefined, fallback = ''): string {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : fallback;
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(str(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = str(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const env = {
  isProduction: process.env.NODE_ENV === 'production',

  supabase: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    serviceRoleKey: str(process.env.SUPABASE_SERVICE_ROLE_KEY),
    /** Supabase solo se activa si URL y anon key estan presentes. */
    enabled: supabaseUrl.length > 0 && supabaseAnonKey.length > 0,
  },

  gemini: {
    apiKey: str(process.env.GEMINI_API_KEY),
    // Alias `-latest`: los identificadores fijados se retiran sin aviso y
    // empiezan a devolver 404. Ver docs/LLM_PROVIDERS.md.
    defaultModel: str(process.env.GEMINI_DEFAULT_MODEL, 'gemini-flash-latest'),
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },

  groq: {
    apiKey: str(process.env.GROQ_API_KEY),
    defaultModel: str(process.env.GROQ_DEFAULT_MODEL, 'openai/gpt-oss-120b'),
    baseUrl: 'https://api.groq.com/openai/v1',
  },

  ollama: {
    // Sin clave: corre en local. `baseUrl` es la unica variable, con el
    // puerto por defecto de Ollama si no se fija otra cosa.
    baseUrl: str(process.env.OLLAMA_BASE_URL, 'http://localhost:11434'),
    /** true si `OLLAMA_BASE_URL` esta definida: la URL por defecto no cuenta como configuracion. */
    explicit: str(process.env.OLLAMA_BASE_URL).length > 0,
    defaultModel: str(process.env.OLLAMA_DEFAULT_MODEL, 'qwen3:8b'),
  },

  credentials: {
    /**
     * Clave maestra con la que se cifran las credenciales guardadas desde Ajustes
     * (opcional). Sin ella, se genera una clave local en `.data/credentials.key`.
     * Ver `src/lib/credentials/crypto.ts`.
     */
    encryptionKey: str(process.env.CREDENTIALS_ENCRYPTION_KEY),
  },

  llm: {
    defaultProvider: normalizeProvider(process.env.DEFAULT_LLM_PROVIDER),
    timeoutMs: int(process.env.LLM_TIMEOUT_MS, 90_000),
  },

  // Generacion de imagenes (tecnica "Generacion de imagenes"). Cloudflare NO es
  // un `ProviderId`: no compite con Gemini/Groq, solo pinta los marcadores
  // `data-ai-image` que deja el LLM. Ver docs/LLM_PROVIDERS.md.
  cloudflare: {
    accountId: str(process.env.CLOUDFLARE_ACCOUNT_ID),
    apiToken: str(process.env.CLOUDFLARE_API_TOKEN),
    // schnell: Apache-2.0, rapido y el mas barato en neuronas. FLUX.2 usa
    // multipart en vez de JSON y no esta soportado.
    model: str(process.env.CLOUDFLARE_IMAGE_MODEL, '@cf/black-forest-labs/flux-1-schnell'),
    baseUrl: normalizeCloudflareBaseUrl(process.env.CLOUDFLARE_API_BASE_URL),
    /** Solo se activa con cuenta Y token, igual que Supabase con URL y anon key. */
    enabled: str(process.env.CLOUDFLARE_ACCOUNT_ID).length > 0 && str(process.env.CLOUDFLARE_API_TOKEN).length > 0,
  },

  images: {
    /** Marcadores que se generan por landing: el resto queda como marcador pendiente. */
    maxPerLanding: Math.min(8, int(process.env.IMAGE_MAX_PER_LANDING, 4)),
    /** Pasos de difusion de schnell (maximo 8 segun Cloudflare; 4 es su valor por defecto). */
    steps: Math.min(8, int(process.env.IMAGE_STEPS, 4)),
    timeoutMs: int(process.env.IMAGE_TIMEOUT_MS, 30_000),
    /** Tiempo maximo de TODO el paso de imagenes de una generacion. */
    stepBudgetMs: int(process.env.IMAGE_STEP_BUDGET_MS, 45_000),
    ratePerHour: int(process.env.IMAGE_RATE_LIMIT_PER_HOUR, 30),
    /**
     * Tras un 429 de "cuota diaria agotada" no se vuelve a llamar a Cloudflare
     * durante este tiempo. No se fija a "hasta las 00:00 UTC" a proposito: hay
     * reportes de cuotas que siguen bloqueadas despues del reinicio.
     */
    quotaCooldownMs: int(process.env.IMAGE_QUOTA_COOLDOWN_MS, 600_000),
    /**
     * Tras no poder GUARDAR una imagen recien generada (falta la tabla o el bucket,
     * politicas...), no se vuelve a llamar a Cloudflare durante este tiempo: cada
     * intento gastaria ~58 neuronas para tirar la imagen. Corto a proposito: en cuanto
     * se arregla el almacen, el siguiente intento debe poder salir bien.
     */
    storageCooldownMs: int(process.env.IMAGE_STORAGE_COOLDOWN_MS, 60_000),
    /** Tope de una imagen descargada: lo que supere esto no es una imagen de landing. */
    maxBytes: 5 * 1024 * 1024,
  },

  rateLimit: {
    maxRequests: int(process.env.RATE_LIMIT_MAX_REQUESTS, 20),
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 3_600_000),
    cooldownMs: int(process.env.RATE_LIMIT_COOLDOWN_MS, 3_000),
  },
} as const;

/**
 * `CLOUDFLARE_API_BASE_URL` existe para apuntar las pruebas a un servidor
 * local (`scripts/stub-cloudflare.mjs`). Un valor que no sea https ni
 * localhost se ignora: la clave nunca debe viajar en claro a otro host.
 */
function normalizeCloudflareBaseUrl(raw: string | undefined): string {
  const value = str(raw).replace(/\/+$/, '');
  if (!value) return CLOUDFLARE_DEFAULT_BASE_URL;
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return value;
  } catch {
    // cae al valor por defecto
  }
  return CLOUDFLARE_DEFAULT_BASE_URL;
}

function normalizeProvider(raw: string | undefined): ProviderId {
  const value = str(raw, 'mock').toLowerCase();
  if (value === 'gemini' || value === 'groq' || value === 'ollama' || value === 'mock') return value;
  return 'mock';
}

/**
 * Credenciales que vienen SOLO del entorno. Es el respaldo de las que cada usuario
 * guarda en Ajustes (`resolveCredentials`) y lo que se usa donde no hay usuario.
 */
export function envCredentials(): EffectiveCredentials {
  return {
    geminiApiKey: env.gemini.apiKey,
    groqApiKey: env.groq.apiKey,
    ollamaBaseUrl: env.ollama.baseUrl,
    cloudflareAccountId: env.cloudflare.accountId,
    cloudflareApiToken: env.cloudflare.apiToken,
  };
}

/** Resumen seguro (sin secretos) que puede viajar al cliente. */
export interface RuntimeConfigSummary {
  supabaseEnabled: boolean;
  storageMode: 'supabase' | 'local';
  defaultProvider: ProviderId;
  providersConfigured: Record<ProviderId, boolean>;
  /** Generacion de imagenes: si hay credenciales de Cloudflare y con que modelo. */
  imageGeneration: { provider: 'cloudflare'; configured: boolean; model: string; maxPerLanding: number };
  timeoutMs: number;
  rateLimit: { maxRequests: number; windowMs: number; cooldownMs: number };
}

/**
 * `credentials` son las efectivas del usuario (Ajustes + entorno). Sin ellas, solo cuenta
 * el entorno: la pantalla de un usuario que guardo su propia clave debe verla como configurada.
 */
export function getRuntimeConfigSummary(credentials: EffectiveCredentials = envCredentials()): RuntimeConfigSummary {
  return {
    supabaseEnabled: env.supabase.enabled,
    storageMode: env.supabase.enabled ? 'supabase' : 'local',
    defaultProvider: env.llm.defaultProvider,
    providersConfigured: {
      mock: true,
      gemini: credentials.geminiApiKey.length > 0,
      groq: credentials.groqApiKey.length > 0,
      // Sin clave: se considera "configurado" porque no hay credencial que
      // pedir. La disponibilidad real (si Ollama esta corriendo) se ve al
      // probar la conexion, igual que con cualquier otro proveedor.
      ollama: true,
    },
    imageGeneration: {
      provider: 'cloudflare',
      configured: credentials.cloudflareAccountId.length > 0 && credentials.cloudflareApiToken.length > 0,
      model: env.cloudflare.model,
      maxPerLanding: env.images.maxPerLanding,
    },
    timeoutMs: env.llm.timeoutMs,
    rateLimit: { ...env.rateLimit },
  };
}
