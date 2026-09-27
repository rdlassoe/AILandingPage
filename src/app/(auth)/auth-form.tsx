'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { EMPTY_AUTH_STATE, type AuthFormState } from './auth-state';
import { Alert, Button, Field, Input } from '@/components/ui';

interface AuthFormProps {
  mode: 'signin' | 'signup';
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  /** true cuando no hay Supabase configurado: no se piden contrasenas. */
  localMode: boolean;
}

export function AuthForm({ mode, action, localMode }: AuthFormProps) {
  const [state, formAction] = useActionState(action, EMPTY_AUTH_STATE);
  const isSignUp = mode === 'signup';

  return (
    <form action={formAction} className="grid gap-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="ok">{state.notice}</Alert> : null}

      {isSignUp || localMode ? (
        <Field label="Nombre" htmlFor="displayName" hint="Como quieres que te llamemos en el estudio.">
          <Input id="displayName" name="displayName" autoComplete="name" placeholder="Robin" />
        </Field>
      ) : null}

      <Field label="Correo" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="tu@correo.com"
        />
      </Field>

      {!localMode ? (
        <Field
          label="Contrasena"
          htmlFor="password"
          required
          hint={isSignUp ? 'Minimo 6 caracteres.' : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            required
            minLength={6}
          />
        </Field>
      ) : null}

      <SubmitButton label={isSignUp ? 'Crear cuenta' : 'Entrar'} />

      <p className="text-center text-sm text-muted">
        {isSignUp ? (
          <>
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="text-accent underline underline-offset-2">
              Inicia sesion
            </Link>
          </>
        ) : (
          <>
            ¿Sin cuenta todavia?{' '}
            <Link href="/register" className="text-accent underline underline-offset-2">
              Crear una
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending} className="w-full">
      {pending ? 'Un momento...' : label}
    </Button>
  );
}
