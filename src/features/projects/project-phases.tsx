'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Compass, Trash2 } from 'lucide-react';

import { Alert, Badge, Button, Panel, PanelBody, PanelHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';
import type { DefineSpec, DiscoverInsights } from '@/types/domain';

/**
 * Panel de fases DISCOVER / DEFINE.
 *
 * DISCOVER consume una llamada al proveedor configurado; DEFINE se deriva
 * despues sin coste. Ambas se guardan en el proyecto y alimentan el prompt.
 */
export function ProjectPhases({
  projectId,
  discover,
  define,
  isMockProvider,
}: {
  projectId: string;
  discover: DiscoverInsights | null;
  define: DefineSpec | null;
  isMockProvider: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const payload = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setError(payload.error?.message ?? 'No pudimos completar el analisis.');
        return;
      }
      router.refresh();
    } catch {
      setError('No pudimos conectar con el servidor.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        eyebrow="Discover → Define"
        title="Analisis del encargo"
        description="Antes de generar nada, el sistema analiza nicho, publico y fricciones, y deriva la arquitectura de informacion."
        actions={
          <Button variant={discover ? 'secondary' : 'primary'} onClick={run} loading={running}>
            <Compass className="size-4" aria-hidden="true" />
            {discover ? 'Rehacer analisis' : 'Ejecutar DISCOVER'}
          </Button>
        }
      />
      <PanelBody className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {!discover ? (
          <p className="text-sm text-muted">
            Todavia no se ha ejecutado el analisis. Sin el, el prompt se construye solo con el brief.
            {isMockProvider ? ' Con el modo demo el analisis es determinista y no consume cuota.' : null}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">Sofisticacion de mercado {discover.marketSophistication}/5</Badge>
              <span className="text-xs text-faint">Analizado el {formatDateTime(discover.generatedAt)}</span>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <Block term="Nicho" value={discover.niche} />
              <Block term="Propuesta de valor" value={discover.valueProposition} />
              <Block term="Insight del publico" value={discover.audienceInsight} />
              <Block term="Contexto" value={discover.context} />
            </dl>

            <div className="grid gap-4 sm:grid-cols-2">
              <List title="Diferenciadores" items={discover.differentiators} />
              <List title="Fricciones a resolver" items={discover.frictions} />
            </div>

            {discover.visualDirections.length > 0 ? (
              <List title="Direcciones visuales posibles" items={discover.visualDirections} />
            ) : null}
          </>
        )}

        {define ? (
          <div className="border-t border-line pt-4">
            <p className="eyebrow mb-2">Define · arquitectura de informacion</p>
            <ol className="grid gap-1.5">
              {define.informationArchitecture.map((section) => (
                <li key={section.id} className="flex gap-3 text-sm">
                  <span className="font-mono text-xs text-faint">{String(section.order).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{section.name}</span>
                    <span className="text-muted"> — {section.purpose}</span>
                    {section.contentNotes ? (
                      <span className="block text-xs text-faint">{section.contentNotes}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Block term="Estrategia de CTA" value={define.ctaStrategy} />
              <Block term="Estrategia de copy" value={define.copyStrategy} />
              <Block term="Jerarquia visual" value={define.visualHierarchy} />
              <Block term="Direccion de estilo" value={define.styleDirection} />
            </dl>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function Block({ term, value }: { term: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="eyebrow">{term}</dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <ul className="grid gap-1 text-sm text-muted">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-faint" aria-hidden="true">
              &middot;
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Eliminacion de proyecto con confirmacion explicita. */
export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? 'No pudimos eliminar el proyecto.');
        setDeleting(false);
        return;
      }
      router.push('/projects');
      router.refresh();
    } catch {
      setError('No pudimos conectar con el servidor.');
      setDeleting(false);
    }
  };

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="size-3.5" aria-hidden="true" />
        Eliminar
      </Button>
    );
  }

  return (
    <div className="grid gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Alert tone="warn" title={`Eliminar "${projectName}"`}>
        Se borran tambien sus prompts y sus Landing Pages. Esta accion no se puede deshacer.
      </Alert>
      <div className="flex gap-2">
        <Button variant="danger" size="sm" onClick={remove} loading={deleting}>
          Si, eliminar
        </Button>
        <Button size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
