'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, FileCode2, Play, RefreshCw, Save, Shuffle, Wand2 } from 'lucide-react';

import { CriticPanel } from './critic-panel';
import { LandingPreview } from '@/components/preview/landing-preview';
import { Alert, Badge, Button, Field, Panel, PanelBody, PanelHeader, Select, Textarea } from '@/components/ui';
import { apiPatch, apiPost } from '@/lib/api-client';
import type { ProviderSummary } from '@/lib/llm/registry';
import { cn, estimateTokens, formatDuration } from '@/lib/utils';
import { VARIATION_STRATEGIES } from '@/types/domain';
import type {
  GenerationReview,
  LandingPage,
  Project,
  PromptSection,
  SeedString,
  VariationStrategy,
} from '@/types/domain';
import type { BuiltPrompt, DesignTechnique, DesignTechniqueId, GenerateLandingResult } from '@/types/services';
import type { ProviderId } from '@/types/llm';

/**
 * Prompt Studio
 *
 * Pantalla principal de trabajo. Distribucion en escritorio:
 *   [ prompt / codigo ]  |  [ preview en iframe ]
 * En movil las dos columnas se apilan.
 *
 * El flujo completo vive aqui: componer -> editar -> ejecutar -> validar ->
 * previsualizar -> auditar -> refinar -> versionar -> guardar.
 */

type Busy = null | 'building' | 'generating' | 'critiquing' | 'refining' | 'varying' | 'saving';

interface StudioProps {
  projects: Project[];
  seeds: SeedString[];
  providers: ProviderSummary[];
  techniques: DesignTechnique[];
  defaultTechniqueIds: DesignTechniqueId[];
  defaultProvider: ProviderId;
}

interface LastRun {
  providerId: ProviderId;
  model: string;
  latencyMs: number;
  isMock: boolean;
  warnings: string[];
  normalized: boolean;
}

export function PromptStudio({
  projects,
  seeds,
  providers,
  techniques,
  defaultTechniqueIds,
  defaultProvider,
}: StudioProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProject = searchParams.get('project');

  const [projectId, setProjectId] = useState<string>(requestedProject ?? projects[0]?.id ?? '');
  const [providerId, setProviderId] = useState<ProviderId>(defaultProvider);
  const [model, setModel] = useState<string>('');
  const [techniqueIds, setTechniqueIds] = useState<DesignTechniqueId[]>(defaultTechniqueIds);
  const [customSeed, setCustomSeed] = useState('');

  const [built, setBuilt] = useState<BuiltPrompt | null>(null);
  const [promptText, setPromptText] = useState('');
  const [edited, setEdited] = useState(false);
  const [view, setView] = useState<'prompt' | 'sections' | 'code'>('prompt');

  const [landing, setLanding] = useState<LandingPage | null>(null);
  const [review, setReview] = useState<GenerationReview | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [extraInstructions, setExtraInstructions] = useState('');
  const [variationStrategy, setVariationStrategy] = useState<VariationStrategy>('same-structure-new-style');

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [criticError, setCriticError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);

  const buildAbort = useRef<AbortController | null>(null);

  const project = useMemo(() => projects.find((item) => item.id === projectId) ?? null, [projects, projectId]);
  const provider = useMemo(
    () => providers.find((item) => item.id === providerId) ?? providers[0],
    [providers, providerId],
  );

  /* --------------------------------------------------- composicion del prompt */

  const buildPrompt = useCallback(
    async (options: { keepEdits?: boolean } = {}) => {
      if (!projectId) return;

      buildAbort.current?.abort();
      const controller = new AbortController();
      buildAbort.current = controller;

      setBusy('building');
      setError(null);

      const result = await apiPost<BuiltPrompt>(
        '/api/prompts/generate',
        {
          projectId,
          customSeedValue: customSeed.trim() || null,
          designTechniques: techniqueIds,
        },
        controller.signal,
      );

      if (controller.signal.aborted) return;

      if (!result.ok) {
        setError(result.error.message);
        setBusy(null);
        return;
      }

      setBuilt(result.data);
      if (!options.keepEdits) {
        setPromptText(result.data.content);
        setEdited(false);
      }
      setBusy(null);
    },
    [projectId, customSeed, techniqueIds],
  );

  useEffect(() => {
    void buildPrompt();
    // Al cambiar de proyecto se descarta el resultado anterior.
    setLanding(null);
    setReview(null);
    setAccepted([]);
    setLastRun(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Recomponer al cambiar tecnicas o Seed. Con debounce: la Seed se escribe a
  // mano y no tiene sentido lanzar una peticion por pulsacion. El efecto de
  // montaje se ignora porque el anterior ya compone el prompt inicial.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!projectId) return;

    const timer = setTimeout(() => void buildPrompt({ keepEdits: edited }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techniqueIds, customSeed]);

  /* ------------------------------------------------------------- acciones */

  const generate = async () => {
    if (!project) return;
    setBusy('generating');
    setError(null);
    setNotice(null);

    const result = await apiPost<GenerateLandingResult>('/api/generations', {
      projectId: project.id,
      promptContent: promptText,
      systemInstruction: built?.systemInstruction,
      providerId,
      model: model || undefined,
      label: edited ? 'Generacion con prompt editado' : 'Generacion desde el Prompt Engine',
    });

    if (!result.ok) {
      setError(result.error.message + (result.error.hint ? ` ${result.error.hint}` : ''));
      setBusy(null);
      return;
    }

    applyResult(result.data);
    setReview(null);
    setAccepted([]);
    setBusy(null);
    router.refresh();
  };

  const critique = async () => {
    if (!landing) return;
    setBusy('critiquing');
    setCriticError(null);

    const result = await apiPost<GenerationReview>('/api/generations/critique', {
      landingPageId: landing.id,
      providerId,
      model: model || undefined,
    });

    if (!result.ok) {
      setCriticError(result.error.message);
      setBusy(null);
      return;
    }

    setReview(result.data);
    setAccepted(result.data.suggestions.map((suggestion) => suggestion.id));
    setBusy(null);
  };

  const refine = async () => {
    if (!landing) return;
    setBusy('refining');
    setCriticError(null);

    const result = await apiPost<GenerateLandingResult>('/api/generations/refine', {
      landingPageId: landing.id,
      reviewId: review?.id,
      acceptedSuggestionIds: accepted,
      extraInstructions: extraInstructions.trim() || undefined,
      providerId,
      model: model || undefined,
    });

    if (!result.ok) {
      setCriticError(result.error.message);
      setBusy(null);
      return;
    }

    applyResult(result.data);
    setReview(null);
    setAccepted([]);
    setExtraInstructions('');
    setNotice(`Nueva version guardada: v${result.data.landingPage.currentVersion}.`);
    setBusy(null);
    router.refresh();
  };

  const makeVariation = async () => {
    if (!landing) return;
    setBusy('varying');
    setError(null);

    const result = await apiPost<GenerateLandingResult>('/api/generations/variation', {
      landingPageId: landing.id,
      strategy: variationStrategy,
      providerId,
      model: model || undefined,
    });

    if (!result.ok) {
      setError(result.error.message);
      setBusy(null);
      return;
    }

    applyResult(result.data);
    setReview(null);
    setAccepted([]);
    setNotice('La variante se ha guardado como una Landing Page independiente.');
    setBusy(null);
    router.refresh();
  };

  const publish = async (status: LandingPage['status']) => {
    if (!landing) return;
    setBusy('saving');
    const result = await apiPatch<LandingPage>(`/api/landings/${landing.id}`, { status });
    if (!result.ok) {
      setError(result.error.message);
      setBusy(null);
      return;
    }
    setLanding(result.data);
    setNotice(`Estado actualizado a "${status}".`);
    setBusy(null);
    router.refresh();
  };

  function applyResult(data: GenerateLandingResult) {
    setLanding(data.landingPage);
    setLastRun({
      providerId: data.providerId,
      model: data.model,
      latencyMs: data.latencyMs,
      isMock: data.isMock,
      warnings: data.validation.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message),
      normalized: data.validation.normalized,
    });
  }

  const toggleTechnique = (id: DesignTechniqueId) => {
    setTechniqueIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleSuggestion = (suggestionId: string) => {
    setAccepted((current) =>
      current.includes(suggestionId)
        ? current.filter((item) => item !== suggestionId)
        : [...current, suggestionId],
    );
  };

  const acceptAll = () => {
    if (!review) return;
    setAccepted((current) =>
      current.length === review.suggestions.length ? [] : review.suggestions.map((item) => item.id),
    );
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setNotice('Prompt copiado al portapapeles.');
    } catch {
      setError('Tu navegador no permitio copiar al portapapeles.');
    }
  };

  /* ---------------------------------------------------------------- vista */

  if (projects.length === 0) {
    return (
      <Panel>
        <PanelBody>
          <div className="grid place-items-center gap-3 py-10 text-center">
            <Wand2 className="size-6 text-faint" aria-hidden="true" />
            <p className="font-medium text-ink">Necesitas un proyecto para componer un prompt</p>
            <p className="max-w-md text-sm text-muted">
              El Prompt Engine parte del brief: publico, objetivo, stack, Seed String y restricciones.
            </p>
            <Link
              href="/projects/new"
              className="inline-flex h-9 items-center border border-accent bg-accent px-3.5 text-sm font-medium text-accent-ink"
            >
              Crear proyecto
            </Link>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  const generating = busy === 'generating' || busy === 'refining' || busy === 'varying';

  return (
    <div className="grid gap-4">
      {/* Barra de configuracion */}
      <Panel>
        <PanelBody className="grid gap-3 lg:grid-cols-4">
          <Field label="Proyecto" htmlFor="studio-project">
            <Select id="studio-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.basics.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Proveedor" htmlFor="studio-provider">
            <Select
              id="studio-provider"
              value={providerId}
              onChange={(event) => {
                setProviderId(event.target.value as ProviderId);
                setModel('');
              }}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.configured ? '' : ' (sin clave)'}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Modelo" htmlFor="studio-model">
            <Select id="studio-model" value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="">Por defecto ({provider?.defaultModel})</option>
              {provider?.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.goodForLongOutput ? '' : ' · salida corta'}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-end gap-2">
            <Button variant="primary" onClick={generate} loading={generating} className="flex-1">
              <Play className="size-4" aria-hidden="true" />
              Generar
            </Button>
            <Button onClick={() => void buildPrompt()} loading={busy === 'building'} title="Reconstruir el prompt">
              <RefreshCw className="size-4" aria-hidden="true" />
              <span className="sr-only">Reconstruir prompt</span>
            </Button>
          </div>
        </PanelBody>
      </Panel>

      {provider && !provider.configured ? (
        <Alert tone="warn" title={`${provider.label} no tiene clave configurada`}>
          La generacion usara el <strong>modo demo</strong> y quedara marcada como tal.{' '}
          <Link href="/settings" className="text-accent underline underline-offset-2">
            Configurar proveedores
          </Link>
          .
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="ok">{notice}</Alert> : null}

      {/* Prompt | Preview */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="flex flex-col">
          <PanelHeader
            eyebrow="Prompt"
            title={
              <span className="flex items-center gap-2">
                Prompt final
                {edited ? <Badge tone="warn">editado</Badge> : null}
              </span>
            }
            description={
              built
                ? `${built.sections.length} secciones · ~${estimateTokens(promptText).toLocaleString('es-ES')} tokens`
                : 'Componiendo...'
            }
            actions={
              <div className="flex items-center gap-1" role="group" aria-label="Vista del panel izquierdo">
                <TabButton active={view === 'prompt'} onClick={() => setView('prompt')} icon={FileCode2}>
                  Prompt
                </TabButton>
                <TabButton active={view === 'sections'} onClick={() => setView('sections')} icon={Eye}>
                  Secciones
                </TabButton>
                <TabButton
                  active={view === 'code'}
                  onClick={() => setView('code')}
                  icon={FileCode2}
                  disabled={!landing}
                >
                  Codigo
                </TabButton>
              </div>
            }
          />

          <div className="flex-1">
            {view === 'prompt' ? (
              <div className="p-3">
                <label htmlFor="prompt-editor" className="sr-only">
                  Prompt final enviado al modelo
                </label>
                <textarea
                  id="prompt-editor"
                  value={promptText}
                  onChange={(event) => {
                    setPromptText(event.target.value);
                    setEdited(true);
                  }}
                  spellCheck={false}
                  className="h-[clamp(360px,52vh,640px)] w-full resize-y border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-ink focus:border-accent"
                />
              </div>
            ) : null}

            {view === 'sections' ? <SectionList sections={built?.sections ?? []} /> : null}

            {view === 'code' && landing ? (
              <div className="p-3">
                <label htmlFor="html-output" className="sr-only">
                  HTML generado
                </label>
                <textarea
                  id="html-output"
                  readOnly
                  value={landing.html}
                  spellCheck={false}
                  className="h-[clamp(360px,52vh,640px)] w-full resize-y border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-muted"
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <Button size="sm" onClick={copyPrompt}>
              <Copy className="size-3.5" aria-hidden="true" />
              Copiar prompt
            </Button>
            {edited ? (
              <Button size="sm" variant="ghost" onClick={() => void buildPrompt()}>
                Descartar ediciones
              </Button>
            ) : null}
            {built && built.conflicts.length > 0 ? (
              <span className="text-xs text-warn">
                {built.conflicts.length} conflicto(s) de stack resueltos automaticamente
              </span>
            ) : null}
          </div>
        </Panel>

        <div className="grid gap-4">
          <LandingPreview html={landing?.html ?? ''} generating={generating} />

          {lastRun ? (
            <Panel>
              <PanelBody className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {lastRun.isMock ? (
                    <Badge tone="warn">modo demo</Badge>
                  ) : (
                    <Badge tone="accent">{lastRun.providerId}</Badge>
                  )}
                  <span className="font-mono text-xs text-muted">{lastRun.model}</span>
                  <span className="text-xs text-faint">{formatDuration(lastRun.latencyMs)}</span>
                  {landing ? <Badge>v{landing.currentVersion}</Badge> : null}
                </div>

                {lastRun.normalized ? (
                  <p className="text-xs text-warn">
                    La respuesta necesito normalizacion: el validador extrajo el HTML del texto devuelto.
                  </p>
                ) : null}

                {lastRun.warnings.length > 0 ? (
                  <ul className="grid gap-0.5 text-xs text-muted">
                    {lastRun.warnings.map((warning) => (
                      <li key={warning}>&middot; {warning}</li>
                    ))}
                  </ul>
                ) : null}

                {landing ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                    <Button size="sm" onClick={() => publish('public')} loading={busy === 'saving'}>
                      <Save className="size-3.5" aria-hidden="true" />
                      Publicar en la biblioteca
                    </Button>
                    <Link
                      href={`/library/${landing.id}`}
                      className="inline-flex h-8 items-center border border-line-strong px-2.5 text-[0.8125rem] text-ink hover:bg-panel-2"
                    >
                      Abrir ficha
                    </Link>
                  </div>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </div>

      {/* Critic Engine */}
      {landing ? (
        <CriticPanel
          review={review}
          accepted={accepted}
          onToggle={toggleSuggestion}
          onAcceptAll={acceptAll}
          extraInstructions={extraInstructions}
          onExtraInstructionsChange={setExtraInstructions}
          onRefine={refine}
          refining={busy === 'refining'}
          critiquing={busy === 'critiquing'}
          onCritique={critique}
          error={criticError}
        />
      ) : null}

      {/* Ajustes del Prompt Engine */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Prompt Engine"
            title="Tecnicas de diseno"
            description="Cada tecnica activa anade un bloque de instrucciones al prompt."
          />
          <PanelBody>
            <ul className="grid gap-1.5">
              {techniques.map((technique) => {
                const checked = techniqueIds.includes(technique.id);
                return (
                  <li key={technique.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 border px-3 py-2 text-sm transition-colors',
                        checked ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel-2',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTechnique(technique.id)}
                        className="mt-1 size-3.5 flex-none accent-[var(--accent)]"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{technique.label}</span>
                        <span className="block text-xs text-muted">{technique.summary}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </PanelBody>
        </Panel>

        <div className="grid gap-4">
          <Panel>
            <PanelHeader
              eyebrow="Direccion creativa"
              title="Seed String de esta ejecucion"
              description="Sustituye temporalmente a la del proyecto sin modificarlo."
            />
            <PanelBody className="space-y-3">
              <Field label="Seed personalizada" htmlFor="studio-seed">
                <Textarea
                  id="studio-seed"
                  rows={2}
                  value={customSeed}
                  onChange={(event) => setCustomSeed(event.target.value)}
                  placeholder={project?.seedStringValue ?? 'diseno suizo + laboratorio industrial + fotografia documental'}
                />
              </Field>

              <div className="flex flex-wrap gap-1.5">
                {seeds.slice(0, 6).map((seed) => (
                  <button
                    key={seed.id}
                    type="button"
                    onClick={() => setCustomSeed(seed.value)}
                    className="border border-dashed border-line-strong px-1.5 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
                  >
                    {seed.name}
                  </button>
                ))}
              </div>
            </PanelBody>
          </Panel>

          {landing ? (
            <Panel>
              <PanelHeader
                eyebrow="Diversificacion"
                title="Generar variante"
                description="Crea una Landing Page independiente a partir de esta, con otra direccion."
              />
              <PanelBody className="flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1">
                  <Field label="Estrategia" htmlFor="variation-strategy">
                    <Select
                      id="variation-strategy"
                      value={variationStrategy}
                      onChange={(event) => setVariationStrategy(event.target.value as VariationStrategy)}
                    >
                      {VARIATION_STRATEGIES.map((strategy) => (
                        <option key={strategy.id} value={strategy.id}>
                          {strategy.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button onClick={makeVariation} loading={busy === 'varying'}>
                  <Shuffle className="size-4" aria-hidden="true" />
                  Generar variante
                </Button>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Eye;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 border px-2 text-xs transition-colors disabled:opacity-40',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-transparent text-muted hover:bg-panel-2',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}

function SectionList({ sections }: { sections: PromptSection[] }) {
  if (sections.length === 0) {
    return <p className="p-4 text-sm text-muted">El prompt todavia no se ha compuesto.</p>;
  }

  return (
    <div className="max-h-[clamp(360px,52vh,640px)] overflow-y-auto">
      <ol className="divide-y divide-line">
        {sections.map((section, index) => (
          <li key={section.id} className="px-4 py-3">
            <p className="flex items-center gap-2">
              <span className="font-mono text-xs text-faint">{String(index + 1).padStart(2, '0')}</span>
              <span className="font-mono text-xs font-medium uppercase tracking-wider text-accent">
                {section.title}
              </span>
            </p>
            <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted">
              {section.body}
            </pre>
          </li>
        ))}
      </ol>
    </div>
  );
}
