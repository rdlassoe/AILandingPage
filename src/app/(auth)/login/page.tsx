import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signInAction } from '../actions';
import { AuthForm } from '../auth-form';
import { Alert } from '@/components/ui';
import { getOptionalUser } from '@/lib/auth/session';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Iniciar sesion' };

export default async function LoginPage() {
  const user = await getOptionalUser();
  if (user) redirect('/dashboard');

  return (
    <div className="grid gap-6">
      <div>
        <p className="eyebrow mb-1.5">Acceso</p>
        <h1 className="text-2xl font-semibold tracking-tight">Entra en el estudio</h1>
        <p className="mt-1.5 text-sm text-muted">
          Tus proyectos, prompts y Landing Pages, separados por cuenta.
        </p>
      </div>

      {!env.supabase.enabled ? (
        <Alert tone="warn" title="Modo local activo">
          No hay Supabase configurado, asi que no se piden contrasenas: el correo solo sirve para
          separar tu espacio de trabajo en este equipo. Anade las variables de Supabase en
          <code className="mx-1 font-mono text-xs">.env.local</code> para activar la autenticacion real.
        </Alert>
      ) : null}

      <AuthForm mode="signin" action={signInAction} localMode={!env.supabase.enabled} />
    </div>
  );
}
