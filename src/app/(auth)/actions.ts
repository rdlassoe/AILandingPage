'use server';

import { redirect } from 'next/navigation';

import type { AuthFormState } from './auth-state';
import { endLocalSession, startLocalSession } from '@/lib/auth/session';
import { getDataStore } from '@/lib/data';
import { env } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
    displayName: String(formData.get('displayName') ?? '').trim(),
  };
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password, displayName } = readCredentials(formData);

  if (!email.includes('@')) {
    return { error: 'Escribe un correo valido.', notice: null };
  }

  // Modo local (sin Supabase): identidad de trabajo, sin contrasena.
  if (!env.supabase.enabled) {
    const name = displayName || email.split('@')[0] || 'Usuario';
    const user = await startLocalSession(email, name);
    const store = await getDataStore();
    await store.ensureProfile(user.id, user.email, user.displayName);
    redirect('/dashboard');
  }

  if (password.length < 6) {
    return { error: 'La contrasena debe tener al menos 6 caracteres.', notice: null };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: translateAuthError(error.message), notice: null };
  }

  redirect('/dashboard');
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password, displayName } = readCredentials(formData);

  if (!email.includes('@')) {
    return { error: 'Escribe un correo valido.', notice: null };
  }

  if (!env.supabase.enabled) {
    const name = displayName || email.split('@')[0] || 'Usuario';
    const user = await startLocalSession(email, name);
    const store = await getDataStore();
    await store.ensureProfile(user.id, user.email, user.displayName);
    redirect('/dashboard');
  }

  if (password.length < 6) {
    return { error: 'La contrasena debe tener al menos 6 caracteres.', notice: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || email.split('@')[0] } },
  });

  if (error) {
    return { error: translateAuthError(error.message), notice: null };
  }

  // Si el proyecto exige confirmacion por correo no hay sesion todavia.
  if (!data.session) {
    return {
      error: null,
      notice: 'Cuenta creada. Revisa tu correo para confirmar la direccion antes de iniciar sesion.',
    };
  }

  redirect('/dashboard');
}

export async function signOutAction(): Promise<void> {
  if (env.supabase.enabled) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } else {
    await endLocalSession();
  }
  redirect('/login');
}

/** Traduce los mensajes de Supabase Auth a algo legible para el usuario. */
function translateAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'Correo o contrasena incorrectos.';
  if (normalized.includes('email not confirmed')) return 'Confirma tu correo antes de iniciar sesion.';
  if (normalized.includes('user already registered')) return 'Ya existe una cuenta con ese correo.';
  if (normalized.includes('password should be')) return 'La contrasena es demasiado corta.';
  if (normalized.includes('rate limit')) return 'Demasiados intentos. Espera un momento.';
  return 'No pudimos completar la operacion. Vuelve a intentarlo.';
}
