'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeSupabaseUrl } from './url';

/**
 * Cliente de navegador. Solo usa variables NEXT_PUBLIC_*: nunca se expone
 * aqui la service role key ni ninguna clave de proveedor LLM.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) return null;
  if (!cached) cached = createBrowserClient(url, anonKey);
  return cached;
}

export function isSupabaseConfiguredInBrowser(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
