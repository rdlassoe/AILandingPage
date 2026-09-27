import 'server-only';

import { cookies } from 'next/headers';

import { getDataStore } from '@/lib/data';
import type { DataStore } from '@/lib/data/types';
import { env } from '@/lib/env';
import { unauthorized } from '@/lib/errors';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Profile } from '@/types/domain';

export const LOCAL_SESSION_COOKIE = 'als_local_session';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  /** true cuando la identidad proviene del modo local sin Supabase. */
  isLocal: boolean;
}

export interface AppContext {
  user: SessionUser;
  store: DataStore;
  profile: Profile;
}

interface LocalSessionPayload {
  id: string;
  email: string;
  displayName: string;
}

function encodeLocalSession(payload: LocalSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeLocalSession(raw: string | undefined): LocalSessionPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<LocalSessionPayload>;
    if (typeof parsed.id === 'string' && typeof parsed.email === 'string') {
      return {
        id: parsed.id,
        email: parsed.email,
        displayName: typeof parsed.displayName === 'string' ? parsed.displayName : parsed.email,
      };
    }
  } catch {
    // cookie corrupta: se ignora y se trata como sesion inexistente
  }
  return null;
}

/**
 * Identidad del modo local.
 *
 * ATENCION: esta cookie NO es un mecanismo de autenticacion. Solo separa
 * espacios de trabajo mientras se desarrolla sin Supabase. La autenticacion
 * real es Supabase Auth; cuando esta configurado, este camino no se usa.
 */
export async function getLocalUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const payload = decodeLocalSession(store.get(LOCAL_SESSION_COOKIE)?.value);
  if (!payload) return null;
  return { ...payload, isLocal: true };
}

export async function startLocalSession(email: string, displayName: string): Promise<SessionUser> {
  const id = `local-${Buffer.from(email.toLowerCase(), 'utf8').toString('hex').slice(0, 24)}`;
  const payload: LocalSessionPayload = { id, email, displayName };
  const store = await cookies();
  store.set(LOCAL_SESSION_COOKIE, encodeLocalSession(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return { ...payload, isLocal: true };
}

export async function endLocalSession(): Promise<void> {
  const store = await cookies();
  store.delete(LOCAL_SESSION_COOKIE);
}

/** Usuario actual, o null si no hay sesion. Nunca lanza. */
export async function getOptionalUser(): Promise<SessionUser | null> {
  if (!env.supabase.enabled) return getLocalUser();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const meta = data.user.user_metadata as Record<string, unknown> | null;
  const displayName =
    (typeof meta?.display_name === 'string' && meta.display_name) ||
    (typeof meta?.full_name === 'string' && meta.full_name) ||
    data.user.email?.split('@')[0] ||
    'Usuario';

  return {
    id: data.user.id,
    email: data.user.email ?? '',
    displayName,
    isLocal: false,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getOptionalUser();
  if (!user) throw unauthorized();
  return user;
}

/** Contexto listo para los servicios: usuario, almacen y perfil garantizado. */
export async function requireContext(): Promise<AppContext> {
  const user = await requireUser();
  const store = await getDataStore();
  const profile = await store.ensureProfile(user.id, user.email, user.displayName);
  return { user, store, profile };
}

export async function getOptionalContext(): Promise<AppContext | null> {
  const user = await getOptionalUser();
  if (!user) return null;
  const store = await getDataStore();
  const profile = await store.ensureProfile(user.id, user.email, user.displayName);
  return { user, store, profile };
}
