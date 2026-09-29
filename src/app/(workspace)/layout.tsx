import { redirect } from 'next/navigation';

import { ActiveProviderProvider } from '@/components/layout/active-provider-context';
import { AppShell } from '@/components/layout/app-shell';
import { getOptionalContext } from '@/lib/auth/session';
import { getStorageMode } from '@/lib/data';
import { env } from '@/lib/env';
import { listProviderStatuses } from '@/lib/llm/registry';

/**
 * Layout del area privada. Protege todas las rutas del workspace:
 * sin sesion no se renderiza nada, se redirige a /login.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOptionalContext();
  if (!ctx) redirect('/login');

  const { user, profile } = ctx;
  const initialProviderId = profile.preferredProvider ?? env.llm.defaultProvider;

  return (
    <ActiveProviderProvider initialProviderId={initialProviderId} providerStatuses={listProviderStatuses()}>
      <AppShell
        info={{
          displayName: user.displayName,
          email: user.email,
          storageMode: getStorageMode(),
        }}
      >
        {children}
      </AppShell>
    </ActiveProviderProvider>
  );
}
