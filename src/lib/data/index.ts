import 'server-only';

import { LocalDataStore } from './local-store';
import { SupabaseDataStore } from './supabase-store';
import type { DataStore } from './types';
import { env } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type { DataStore } from './types';
export * from './types';

let localSingleton: LocalDataStore | null = null;

/**
 * Devuelve la implementacion de `DataStore` adecuada al entorno.
 *
 * - Con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`:
 *   Supabase, con RLS aplicando el aislamiento por usuario.
 * - Sin ellas: almacen local en `./.data/db.json`, pensado solo para
 *   desarrollo y evaluacion sin servicios externos.
 */
export async function getDataStore(): Promise<DataStore> {
  if (env.supabase.enabled) {
    const client = await createSupabaseServerClient();
    return new SupabaseDataStore(client);
  }
  if (!localSingleton) localSingleton = new LocalDataStore();
  return localSingleton;
}

export function getStorageMode(): 'supabase' | 'local' {
  return env.supabase.enabled ? 'supabase' : 'local';
}
