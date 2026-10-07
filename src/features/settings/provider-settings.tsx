'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExternalLink, PlugZap, Save } from 'lucide-react';

import { Alert, Badge, Button, Field, Panel, PanelBody, PanelHeader, Select, StatusDot } from '@/components/ui';
import { apiPatch, apiPost } from '@/lib/api-client';
import type { CredentialsStatus } from '@/lib/credentials';
import type { ProviderSummary } from '@/lib/llm/registry';
import { formatDuration } from '@/lib/utils';
import type { Profile } from '@/types/domain';
import type { ProviderHealth, ProviderId } from '@/types/llm';
import { CredentialForm, type CredentialFieldDef } from './credential-form';

/**
 * Casillas de credenciales de cada proveedor. Mock no tiene (siempre disponible, sin clave).
 * Ollama no usa clave: es la URL del servidor, que solo se puede cambiar en modo local.
 */
const PROVIDER_FIELDS: Partial<Record<ProviderId, CredentialFieldDef[]>> = {
  gemini: [
    { field: 'geminiApiKey', label: 'Clave API de Gemini', kind: 'secret', placeholder: 'AIza…' },
  ],
  groq: [{ field: 'groqApiKey', label: 'Clave API de Groq', kind: 'secret', placeholder: 'gsk_…' }],
  ollama: [
    {
      field: 'ollamaBaseUrl',
      label: 'URL del servidor de Ollama',
      kind: 'text',
      placeholder: 'http://localhost:11434',
      help: 'Por defecto http://localhost:11434. No lleva clave.',
    },
  ],
};

/**
 * Configuracion de proveedores de IA.
 *
 * Cada usuario puede pegar aqui sus claves API. Se guardan cifradas, solo para su cuenta, y NUNCA
 * vuelven al navegador: la pantalla solo muestra de donde sale cada clave y sus ultimos cuatro
 * caracteres. Las variables de entorno del servidor siguen valiendo como respaldo compartido
 * (la clave de Ajustes gana a la del servidor).
 */
export function ProviderSettings({
  providers,
  profile,
  defaultProvider,
  credentials,
}: {
  providers: ProviderSummary[];
  profile: Profile;
  defaultProvider: ProviderId;
  credentials: CredentialsStatus;
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

      <CredentialsNotice credentials={credentials} />

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
                  {provider.id === 'mock' ? null : provider.configured ? (
                    <Badge tone="ok">{provider.envKey ? 'clave configurada' : 'disponible'}</Badge>
                  ) : (
                    <Badge>sin clave</Badge>
                  )}
                </div>

                {PROVIDER_FIELDS[provider.id] ? (
                  <CredentialForm fields={PROVIDER_FIELDS[provider.id] ?? []} credentials={credentials} />
                ) : null}

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

/**
 * Donde viven las credenciales y por que se puede (o no) guardar. Es el unico sitio que lo explica:
 * sirve tambien al panel de imagenes, que va justo debajo.
 */
export function CredentialsNotice({ credentials }: { credentials: CredentialsStatus }) {
  const { storage } = credentials;

  if (storage.unreadable) {
    return (
      <Alert tone="warn" title="Hay claves guardadas que no se pueden descifrar">
        {storage.problem} Mientras tanto se usan las del servidor, si las hay. Escribe de nuevo las claves para
        sustituirlas.
      </Alert>
    );
  }

  if (!storage.available) {
    return (
      <Alert tone="warn" title="Ahora mismo no se pueden guardar claves desde aqui">
        {storage.problem ?? 'No hay forma de cifrarlas.'} Las claves del servidor (variables de entorno) siguen
        funcionando.
      </Alert>
    );
  }

  return (
    <Alert tone="info" title="Donde se guardan tus claves">
      Se guardan <strong>cifradas</strong> (AES-256-GCM) y solo para tu cuenta; nunca vuelven al navegador ni salen en
      los registros. La clave de cifrado esta{' '}
      {storage.keySource === 'env' ? (
        <>
          en <code className="font-mono text-xs">CREDENTIALS_ENCRYPTION_KEY</code>
        </>
      ) : (
        <>
          en <code className="font-mono text-xs">.data/credentials.key</code> (se crea sola, esta en .gitignore: no la
          subas ni la borres, o las claves guardadas dejaran de poder leerse)
        </>
      )}
      . Si falta una clave aqui, se usa la del servidor (<code className="font-mono text-xs">.env.local</code>).
    </Alert>
  );
}
