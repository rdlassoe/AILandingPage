import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { getOptionalUser } from '@/lib/auth/session';
import { getStorageMode } from '@/lib/data';
import { env } from '@/lib/env';
import { getProvider } from '@/lib/llm/registry';

/**
 * Layout del area privada. Protege todas las rutas del workspace:
 * sin sesion no se renderiza nada, se redirige a /login.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await getOptionalUser();
  if (!user) redirect('/login');

  const provider = getProvider(env.llm.defaultProvider);

  return (
    <AppShell
      info={{
        displayName: user.displayName,
        email: user.email,
        storageMode: getStorageMode(),
        activeProvider: provider.id,
        providerConfigured: provider.isConfigured(),
      }}
    >
      {children}
    </AppShell>
  );
}
