import 'server-only';

import { normalizeSupabaseUrl } from '@/lib/supabase/url';
import type { ProviderId } from '@/types/llm';

/**
 * Lectura centralizada de variables de entorno.
 *
 * Este modulo esta marcado como `server-only`: si algun componente de cliente
 * lo importa por error, el build falla en lugar de filtrar claves al bundle.
 */

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
    defaultModel: str(process.env.OLLAMA_DEFAULT_MODEL, 'qwen3:8b'),
  },

  llm: {
    defaultProvider: normalizeProvider(process.env.DEFAULT_LLM_PROVIDER),
    timeoutMs: int(process.env.LLM_TIMEOUT_MS, 90_000),
  },

  rateLimit: {
    maxRequests: int(process.env.RATE_LIMIT_MAX_REQUESTS, 20),
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 3_600_000),
    cooldownMs: int(process.env.RATE_LIMIT_COOLDOWN_MS, 3_000),
  },
} as const;

function normalizeProvider(raw: string | undefined): ProviderId {
  const value = str(raw, 'mock').toLowerCase();
  if (value === 'gemini' || value === 'groq' || value === 'ollama' || value === 'mock') return value;
  return 'mock';
}

/** Resumen seguro (sin secretos) que puede viajar al cliente. */
export interface RuntimeConfigSummary {
  supabaseEnabled: boolean;
  storageMode: 'supabase' | 'local';
  defaultProvider: ProviderId;
  providersConfigured: Record<ProviderId, boolean>;
  timeoutMs: number;
  rateLimit: { maxRequests: number; windowMs: number; cooldownMs: number };
}

export function getRuntimeConfigSummary(): RuntimeConfigSummary {
  return {
    supabaseEnabled: env.supabase.enabled,
    storageMode: env.supabase.enabled ? 'supabase' : 'local',
    defaultProvider: env.llm.defaultProvider,
    providersConfigured: {
      mock: true,
      gemini: env.gemini.apiKey.length > 0,
      groq: env.groq.apiKey.length > 0,
      // Sin clave: se considera "configurado" porque no hay credencial que
      // pedir. La disponibilidad real (si Ollama esta corriendo) se ve al
      // probar la conexion, igual que con cualquier otro proveedor.
      ollama: true,
    },
    timeoutMs: env.llm.timeoutMs,
    rateLimit: { ...env.rateLimit },
  };
}
