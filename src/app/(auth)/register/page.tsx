import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signUpAction } from '../actions';
import { AuthForm } from '../auth-form';
import { Alert } from '@/components/ui';
import { getOptionalUser } from '@/lib/auth/session';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Crear cuenta' };

export default async function RegisterPage() {
  const user = await getOptionalUser();
  if (user) redirect('/dashboard');

  return (
    <div className="grid gap-6">
      <div>
        <p className="eyebrow mb-1.5">Registro</p>
        <h1 className="text-2xl font-semibold tracking-tight">Crea tu cuenta</h1>
        <p className="mt-1.5 text-sm text-muted">
          Empezaras con el catalogo de tecnologias y Seed Strings ya cargado.
        </p>
      </div>

      {!env.supabase.enabled ? (
        <Alert tone="warn" title="Modo local activo">
          Sin Supabase configurado no hay registro real: el correo crea un espacio de trabajo local
          en este equipo.
        </Alert>
      ) : null}

      <AuthForm mode="signup" action={signUpAction} localMode={!env.supabase.enabled} />
    </div>
  );
}
