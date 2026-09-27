'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExternalLink, PlugZap, Save } from 'lucide-react';

import { Alert, Badge, Button, Field, Panel, PanelBody, PanelHeader, Select, StatusDot } from '@/components/ui';
import { apiPatch, apiPost } from '@/lib/api-client';
import type { ProviderSummary } from '@/lib/llm/registry';
import { formatDuration } from '@/lib/utils';
import type { Profile } from '@/types/domain';
import type { ProviderHealth, ProviderId } from '@/types/llm';

/**
 * Configuracion de proveedores de IA.
 *
 * Las claves API NUNCA se introducen ni se muestran aqui: viven solo en las
 * variables de entorno del servidor. Esta pantalla informa de que proveedores
 * estan disponibles, permite probar la conexion y fija las preferencias.
 */
export function ProviderSettings({
  providers,
  profile,
  defaultProvider,
}: {
  providers: ProviderSummary[];
  profile: Profile;
  defaultProvider: ProviderId;
}) {
  const router = useRouter();
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [preferredProvider, setPreferredProvider] = useState<ProviderId>(profile.preferredProvider);
  const [preferredModel, setPreferredModel] = useState<string>(profile.preferredModel ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = providers.find((provider) => provider.id === preferredProvider);

  const test = async (providerId: ProviderId) => {
    setTesting(providerId);
    setError(null);

    const result = await apiPost<ProviderHealth>('/api/providers/test', { providerId });
    if (!result.ok) {
      setError(result.error.message);
      setTesting(null);
      return;
    }

    setHealth((current) => ({ ...current, [providerId]: result.data }));
    setTesting(null);
  };

  const savePreferences = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);

    const result = await apiPatch<Profile>('/api/profile', {
      preferredProvider,
      preferredModel: preferredModel || null,
    });

    if (!result.ok) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setNotice('Preferencias guardadas.');
    setSaving(false);
    router.refresh();
  };

  return (
    <div className="grid gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="ok">{notice}</Alert> : null}

      <Alert tone="info" title="Donde viven las claves API">
        Las claves se leen solo en el servidor desde <code className="font-mono text-xs">.env.local</code> y nunca
        llegan al navegador, ni a la base de datos, ni a los registros. Por eso esta pantalla no tiene campos para
        escribirlas: se configuran en el archivo de entorno y se reinicia el servidor.
      </Alert>

      <div className="grid gap-4 lg:grid-cols-3">
        {providers.map((provider) => {
          const status = health[provider.id];
          const state = status?.status ?? (provider.configured ? 'connected' : 'not_configured');

          return (
            <Panel key={provider.id} className="flex flex-col">
              <PanelHeader
                eyebrow={provider.id === defaultProvider ? 'Por defecto' : 'Proveedor'}
                title={provider.label}
                description={
                  provider.envKey ? (
                    <span className="font-mono text-xs">{provider.envKey}</span>
                  ) : (
                    'Siempre disponible, sin clave ni cuota'
                  )
                }
              />
              <PanelBody className="flex flex-1 flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <StatusDot status={state} />
                  {provider.configured ? <Badge tone="ok">clave detectada</Badge> : <Badge>sin clave</Badge>}
                </div>

                {status ? (
                  <p
                    className={
                      status.status === 'error' ? 'text-xs text-danger' : 'text-xs text-muted'
                    }
                  >
                    {status.message}
                    {status.latencyMs ? ` · ${formatDuration(status.latencyMs)}` : ''}
                  </p>
                ) : null}

                <div>
                  <p className="eyebrow mb-1">Modelos</p>
                  <ul className="grid gap-0.5 text-xs text-muted">
                    {provider.models.map((model) => (
                      <li key={model.id} className="flex items-center gap-1.5">
                        <span className="font-mono">{model.id}</span>
                        {model.id === provider.defaultModel ? (
                          <span className="text-[0.6875rem] uppercase tracking-wider text-accent">defecto</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <Button size="sm" onClick={() => test(provider.id)} loading={testing === provider.id}>
                    <PlugZap className="size-3.5" aria-hidden="true" />
                    Probar conexion
                  </Button>
                  {provider.envKey ? (
                    <a
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-[0.8125rem] text-muted hover:bg-panel-2 hover:text-ink"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      Obtener clave
                    </a>
                  ) : null}
                </div>
              </PanelBody>
            </Panel>
          );
        })}
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Preferencias"
          title="Proveedor y modelo por defecto"
          description="Se usan al abrir el Prompt Studio. Puedes cambiarlos en cada ejecucion."
        />
        <PanelBody className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Proveedor preferido" htmlFor="preferred-provider">
            <Select
              id="preferred-provider"
              value={preferredProvider}
              onChange={(event) => {
                setPreferredProvider(event.target.value as ProviderId);
                setPreferredModel('');
              }}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                  {provider.configured ? '' : ' (sin clave)'}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Modelo preferido" htmlFor="preferred-model">
            <Select
              id="preferred-model"
              value={preferredModel}
              onChange={(event) => setPreferredModel(event.target.value)}
            >
              <option value="">Por defecto del proveedor</option>
              {selected?.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </Select>
          </Field>

          <Button variant="primary" onClick={savePreferences} loading={saving}>
            <Save className="size-4" aria-hidden="true" />
            Guardar
          </Button>
        </PanelBody>
      </Panel>
    </div>
  );
}
