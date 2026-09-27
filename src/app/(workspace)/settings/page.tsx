import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { ProviderSettings } from '@/features/settings/provider-settings';
import { Panel, PanelBody, PanelHeader, DefinitionList, Badge } from '@/components/ui';
import { requireContext } from '@/lib/auth/session';
import { getStorageMode } from '@/lib/data';
import { env, getRuntimeConfigSummary } from '@/lib/env';
import { getProviderSummaries } from '@/lib/llm/registry';
import { peekRateLimit } from '@/lib/rate-limit';
import { formatDuration } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ajustes' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { user, profile } = await requireContext();

  const runtime = getRuntimeConfigSummary();
  const rateLimit = peekRateLimit(user.id);
  const providers = await getProviderSummaries();

  return (
    <>
      <PageHeader
        eyebrow="Configuracion"
        title="Modelos de IA y entorno"
        description="Estado de los proveedores, preferencias de generacion y limites de uso."
      />
      <PageBody>
        <ProviderSettings
          providers={providers}
          profile={profile}
          defaultProvider={env.llm.defaultProvider}
        />

        <Panel>
          <PanelHeader
            eyebrow="Entorno"
            title="Configuracion en ejecucion"
            description="Valores efectivos leidos de las variables de entorno. Ningun secreto aparece aqui."
          />
          <PanelBody>
            <DefinitionList
              items={[
                {
                  term: 'Almacenamiento',
                  value: (
                    <Badge tone={getStorageMode() === 'supabase' ? 'ok' : 'warn'}>
                      {getStorageMode() === 'supabase' ? 'Supabase + RLS' : 'Local en ./.data'}
                    </Badge>
                  ),
                },
                { term: 'Proveedor por defecto', value: runtime.defaultProvider },
                { term: 'Timeout por peticion', value: formatDuration(runtime.timeoutMs) },
                {
                  term: 'Limite de generaciones',
                  value: `${rateLimit.remaining} de ${rateLimit.limit} disponibles en esta ventana`,
                },
                {
                  term: 'Alcance del limite',
                  value:
                    'Solo cuenta las llamadas a proveedores externos; el modo demo y Ollama (local) no consumen cuota.',
                },
                { term: 'Enfriamiento entre peticiones', value: formatDuration(runtime.rateLimit.cooldownMs) },
                { term: 'Cuenta', value: `${profile.displayName} \u00b7 ${profile.email}` },
              ]}
            />
          </PanelBody>
        </Panel>
      </PageBody>
    </>
  );
}
