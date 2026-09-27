import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * Cliente de Supabase para Server Components, Route Handlers y Server Actions.
 * Usa las cookies de la peticion, de modo que todas las consultas se ejecutan
 * con la identidad del usuario y las politicas RLS se aplican de verdad.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Los Server Components no pueden escribir cookies: el refresco de
          // sesion lo realiza el middleware.
        }
      },
    },
  });
}
