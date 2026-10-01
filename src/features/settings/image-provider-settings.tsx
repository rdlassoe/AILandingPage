'use client';

import { useState } from 'react';
import { ExternalLink, PlugZap } from 'lucide-react';

import { Alert, Badge, Button, Panel, PanelBody, PanelHeader, StatusDot } from '@/components/ui';
import { apiPost } from '@/lib/api-client';
import type { ImageConnectionHealth } from '@/lib/images/cloudflare';
import { formatDuration } from '@/lib/utils';

/**
 * Estado del proveedor de imagenes (Cloudflare Workers AI, FLUX).
 *
 * No es un proveedor de texto: no se elige ni se pone por defecto, solo
 * rellena los marcadores de imagen que deja el LLM cuando esta elegida la
 * tecnica "Generacion de imagenes". Por eso tiene su propio panel en vez de una
 * tarjeta mas de la rejilla. Las credenciales viven solo en las variables de
 * entorno del servidor, igual que las claves de los demas proveedores.
 */
export function ImageProviderSettings({
  configured,
  model,
  maxPerLanding,
}: {
  configured: boolean;
  model: string;
  maxPerLanding: number;
}) {
  const [health, setHealth] = useState<ImageConnectionHealth | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const test = async () => {
    setTesting(true);
    setError(null);
    const result = await apiPost<ImageConnectionHealth>('/api/providers/image/test', {});
    setTesting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setHealth(result.data);
  };

  const state = health ? (health.ok ? 'connected' : 'error') : configured ? 'connected' : 'not_configured';

  return (
    <Panel>
      <PanelHeader
        eyebrow="Imagenes"
        title="Cloudflare Workers AI (FLUX)"
        description={
          <span className="font-mono text-xs">CLOUDFLARE_ACCOUNT_ID · CLOUDFLARE_API_TOKEN</span>
        }
      />
      <PanelBody className="grid gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex items-center justify-between gap-2">
          <StatusDot status={state} />
          {configured ? <Badge tone="ok">credenciales detectadas</Badge> : <Badge>sin credenciales</Badge>}
        </div>

        {health ? (
          <p className={health.ok ? 'text-xs text-muted' : 'text-xs text-danger'}>
            {health.message}
            {health.latencyMs ? ` · ${formatDuration(health.latencyMs)}` : ''}
          </p>
        ) : null}

        <p className="text-xs text-muted">
          Genera las imagenes de la tecnica «Generacion de imagenes» (hasta {maxPerLanding} por pagina) con{' '}
          <span className="font-mono">{model}</span>. La capa gratuita da 10 000 neuronas al dia, de unas 170 a 230
          imagenes segun su resolucion. Sin credenciales, la tecnica deja marcadores con la descripcion de cada
          imagen. «Probar conexion» genera una imagen de un solo paso (unas pocas decenas de neuronas).
        </p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={test} loading={testing}>
            <PlugZap className="size-3.5" aria-hidden="true" />
            Probar conexion
          </Button>
          <a
            href="https://developers.cloudflare.com/workers-ai/get-started/rest-api/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 border border-line-strong px-2.5 text-[0.8125rem] text-muted hover:bg-panel-2 hover:text-ink"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Obtener credenciales
          </a>
        </div>
      </PanelBody>
    </Panel>
  );
}
