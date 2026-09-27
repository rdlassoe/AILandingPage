import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * Cliente con service role. SALTA RLS, por lo que solo debe usarse en tareas
 * administrativas del servidor (seed, mantenimiento) y nunca a partir de
 * entrada del usuario.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  if (!env.supabase.enabled || !env.supabase.serviceRoleKey) return null;
  return createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
