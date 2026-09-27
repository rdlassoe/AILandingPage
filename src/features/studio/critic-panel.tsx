'use client';

import { Gauge, ShieldCheck, Sparkles } from 'lucide-react';

import { Alert, Badge, Button, Panel, PanelBody, PanelHeader, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { CriticSeverity, GenerationReview } from '@/types/domain';

/**
 * Panel del Critic Engine.
 *
 * Muestra lo que el auditor propone, pero NO aplica nada por su cuenta: el
 * usuario marca que sugerencias acepta y solo entonces se lanza el
 * refinamiento.
 */

const SEVERITY_TONE: Record<CriticSeverity, 'danger' | 'warn' | 'accent' | 'neutral'> = {
  critical: 'danger',
  high: 'warn',
  medium: 'accent',
  low: 'neutral',
};

const SEVERITY_ORDER: CriticSeverity[] = ['critical', 'high', 'medium', 'low'];

export function CriticPanel({
  review,
  accepted,
  onToggle,
  onAcceptAll,
  extraInstructions,
  onExtraInstructionsChange,
  onRefine,
  refining,
  critiquing,
  onCritique,
  error,
}: {
  review: GenerationReview | null;
  accepted: string[];
  onToggle: (suggestionId: string) => void;
  onAcceptAll: () => void;
  extraInstructions: string;
  onExtraInstructionsChange: (value: string) => void;
  onRefine: () => void;
  refining: boolean;
  critiquing: boolean;
  onCritique: () => void;
  error: string | null;
}) {
  if (!review) {
    return (
      <Panel>
        <PanelHeader
          eyebrow="Critique"
          title="Auditoria de la pagina"
          description="Un segundo agente revisa UX, accesibilidad, jerarquia, responsive, CTA, copy y codigo antes de refinar."
          actions={
            <Button variant="primary" onClick={onCritique} loading={critiquing}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              Auditar
            </Button>
          }
        />
        <PanelBody>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <p className="text-sm text-muted">
            Ejecuta la auditoria cuando tengas una version que te convenza en lo general. El critico no
            modifica nada: propone cambios concretos y tu decides cuales se aplican.
          </p>
        </PanelBody>
      </Panel>
    );
  }

  const sortedIssues = [...review.issues].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  const issueById = new Map(review.issues.map((issue) => [issue.id, issue]));

  return (
    <Panel>
      <PanelHeader
        eyebrow="Critique"
        title="Auditoria de la pagina"
        description={`${review.issues.length} problemas detectados · ${review.suggestions.length} recomendaciones`}
        actions={
          <Button size="sm" onClick={onCritique} loading={critiquing}>
            Volver a auditar
          </Button>
        }
      />

      <PanelBody className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {review.isMock ? (
          <Alert tone="warn" title="Auditoria en modo demo">
            Esta revision proviene del analizador estatico de la aplicacion (comprobaciones reales sobre el
            HTML), no de un modelo. Configura un proveedor para obtener una critica de diseno y copy.
          </Alert>
        ) : null}

        {/* Puntuaciones */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Score label="Global" value={review.scores.overall} highlight />
          <Score label="UX" value={review.scores.ux} />
          <Score label="Accesib." value={review.scores.accessibility} />
          <Score label="Contenido" value={review.scores.content} />
          <Score label="Codigo" value={review.scores.code} />
          <Score label="Diseno" value={review.scores.design} />
        </div>

        {review.issues.length === 0 ? (
          <Alert tone="ok" title="La auditoria no encontro problemas bloqueantes">
            Las comprobaciones automaticas pasan. Eso no sustituye una lectura humana del copy y de la
            jerarquia: revisa el texto en voz alta antes de publicar.
          </Alert>
        ) : null}

        {/* Problemas */}
        <div hidden={review.issues.length === 0}>
          <p className="eyebrow mb-2">Problemas detectados</p>
          <ul className="grid gap-2">
            {sortedIssues.map((issue) => (
              <li key={issue.id} className="border border-line bg-panel-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
                  <Badge>{issue.dimension}</Badge>
                  <p className="min-w-0 flex-1 font-medium text-ink">{issue.title}</p>
                </div>
                <p className="mt-1 text-sm text-muted">{issue.description}</p>
                {issue.location ? (
                  <p className="mt-1 font-mono text-[0.6875rem] text-faint">{issue.location}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {/* Recomendaciones */}
        <div hidden={review.suggestions.length === 0}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Recomendaciones ({accepted.length} seleccionadas)</p>
            <Button size="sm" variant="ghost" onClick={onAcceptAll}>
              {accepted.length === review.suggestions.length ? 'Quitar todas' : 'Seleccionar todas'}
            </Button>
          </div>

          <ul className="grid gap-1.5">
            {review.suggestions.map((suggestion) => {
              const checked = accepted.includes(suggestion.id);
              const issue = suggestion.issueId ? issueById.get(suggestion.issueId) : undefined;

              return (
                <li key={suggestion.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 border px-3 py-2.5 text-sm transition-colors',
                      checked ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(suggestion.id)}
                      className="mt-1 size-3.5 flex-none accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{suggestion.title}</span>
                        <Badge tone={suggestion.impact === 'alto' ? 'warn' : 'neutral'}>
                          impacto {suggestion.impact}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-muted">{suggestion.action}</span>
                      {issue ? (
                        <span className="mt-1 block font-mono text-[0.6875rem] text-faint">
                          resuelve: {issue.title}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Refinamiento */}
        <div className="border-t border-line pt-4">
          <label htmlFor="extra-instructions" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
            Instrucciones adicionales para el refinamiento
          </label>
          <Textarea
            id="extra-instructions"
            rows={3}
            value={extraInstructions}
            onChange={(event) => onExtraInstructionsChange(event.target.value)}
            placeholder="Ademas de lo anterior: acorta el hero y elimina la seccion de metricas."
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={onRefine}
              loading={refining}
              disabled={accepted.length === 0 && extraInstructions.trim().length === 0}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Refinar y regenerar
            </Button>
            <span className="text-xs text-faint">
              Crea una version nueva de la misma Landing Page; la anterior se conserva en el historial.
            </span>
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}

function Score({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  const tone = value >= 80 ? 'text-ok' : value >= 60 ? 'text-warn' : 'text-danger';
  return (
    <div className={cn('border border-line px-2.5 py-2', highlight && 'border-line-strong bg-panel-2')}>
      <p className="eyebrow flex items-center gap-1">
        {highlight ? <Gauge className="size-3" aria-hidden="true" /> : null}
        {label}
      </p>
      <p className={cn('mt-1 font-mono text-xl leading-none', tone)}>{value}</p>
    </div>
  );
}
