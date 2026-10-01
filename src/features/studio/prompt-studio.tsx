'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, FileCode2, ImagePlus, Play, Save, Shuffle, Wand2 } from 'lucide-react';

import { CriticPanel } from './critic-panel';
import { HtmlCodeEditor } from '@/components/editor/html-code-editor.lazy';
import { useActiveProvider } from '@/components/layout/active-provider-context';
import { LandingPreview } from '@/components/preview/landing-preview';
import { Alert, Badge, Button, Field, Panel, PanelBody, PanelHeader, Select } from '@/components/ui';
import { EditorAlerts, EditorToolbar } from '@/features/editor/editor-controls';
import { InspectorPanel } from '@/features/editor/inspector-panel';
import { useDebouncedValue } from '@/features/editor/use-debounced-value';
import { useInspectorSync } from '@/features/editor/use-inspector-sync';
import { useLandingEditor } from '@/features/editor/use-landing-editor';
import { apiPatch, apiPost } from '@/lib/api-client';
import { IMAGE_ATTR } from '@/lib/images/slots';
import type { ProviderSummary } from '@/lib/llm/registry';
import { cn, estimateTokens, formatDuration } from '@/lib/utils';
import { VARIATION_STRATEGIES } from '@/types/domain';
import type { GenerationReview, LandingPage, Project, PromptSection, VariationStrategy } from '@/types/domain';
import type {
  BuiltPrompt,
  ComposePromptResult,
  DesignTechnique,
  DesignTechniqueId,
  GenerateLandingResult,
  ImageStepReport,
} from '@/types/services';
import type { RetryImagesResult } from '@/services/landing-generator';
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

type Busy = null | 'composing' | 'generating' | 'critiquing' | 'refining' | 'varying' | 'saving' | 'imaging';

interface StudioProps {
  projects: Project[];
  providers: ProviderSummary[];
  techniques: DesignTechnique[];
  defaultTechniqueIds: DesignTechniqueId[];
  /** Hay credenciales de Cloudflare: la tecnica de imagenes genera de verdad en vez de dejar marcadores. */
  imageGenerationConfigured: boolean;
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
  providers,
  techniques,
  defaultTechniqueIds,
  imageGenerationConfigured,
}: StudioProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProject = searchParams.get('project');

  const [projectId, setProjectId] = useState<string>(requestedProject ?? projects[0]?.id ?? '');
  // El proveedor activo es global (barra lateral + Prompt Studio): elegirlo
  // aqui se refleja de inmediato en el indicador de la barra lateral.
  const { activeProviderId: providerId, setActiveProviderId: setProviderId } = useActiveProvider();
  const [model, setModel] = useState<string>('');
  const [techniqueIds, setTechniqueIds] = useState<DesignTechniqueId[]>(defaultTechniqueIds);

  const [built, setBuilt] = useState<BuiltPrompt | null>(null);
  const [promptText, setPromptText] = useState('');
  const [edited, setEdited] = useState(false);
  const [view, setView] = useState<'prompt' | 'sections' | 'code'>('prompt');
  /** Id de la `prompt_version` ya compuesta y persistida (botón "Generar prompt"). */
  const [composedVersionId, setComposedVersionId] = useState<string | null>(null);

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
  /** Paso de imagenes de la ultima generacion (solo si la pagina lleva marcadores). */
  const [imageReport, setImageReport] = useState<ImageStepReport | null>(null);

  // Edicion del HTML generado. Guardar es explicito: lo escrito no es definitivo (y el
  // critico no lo ve) hasta que se guarda como una version nueva.
  const landingEditor = useLandingEditor(landing, {
    onSaved: (next) => {
      setLanding(next);
      router.refresh();
    },
  });
  // Mientras se escribe, la vista previa espera un instante; sin cambios, muestra el texto tal cual.
  const debouncedDraft = useDebouncedValue(landingEditor.draft, 400);
  const previewHtml = landingEditor.dirty ? debouncedDraft : landingEditor.draft;
  // Un clic en la pagina lleva a la pestana del codigo, donde salta a la linea del elemento.
  const inspector = useInspectorSync({ text: landingEditor.draft, onReveal: () => setView('code') });

  const project = useMemo(() => projects.find((item) => item.id === projectId) ?? null, [projects, projectId]);
  const provider = useMemo(
    () => providers.find((item) => item.id === providerId) ?? providers[0],
    [providers, providerId],
  );
  // Se pidio un proveedor real y configurado, pero la composicion cayo al
  // borrador determinista (limite de cuota, timeout, formato invalido...).
  // Distinto del caso "proveedor sin clave": ese ya avisa por separado y aqui
  // ni siquiera se intenta el LLM.
  const composeFallback = !!built && !built.composedByLLM && !!provider && provider.id !== 'mock' && provider.configured;

  /**
   * Limpia el prompt actual: no hay borrador ni aproximacion, solo lo que
   * produjo de verdad la ultima llamada a "Generar prompt". Se usa al cambiar
   * de proyecto o de tecnicas, momentos en los que ese resultado deja de
   * corresponder al estado actual.
   */
  const clearPrompt = () => {
    setBuilt(null);
    setPromptText('');
    setEdited(false);
    setComposedVersionId(null);
  };

  useEffect(() => {
    clearPrompt();
    // Al cambiar de proyecto se descarta el resultado anterior.
    setLanding(null);
    setReview(null);
    setAccepted([]);
    setLastRun(null);
  }, [projectId]);

  // Cambiar las tecnicas activas invalida el prompt ya generado (si lo
  // habia): hay que volver a pulsar "Generar prompt" para que las refleje.
  // El efecto de montaje se ignora porque no hay nada que invalidar todavia.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    clearPrompt();
  }, [techniqueIds]);

  /* ------------------------------------------------------------- acciones */

  /**
   * Unica forma de obtener el prompt: lo compone `buildPromptForProject`
   * (con LLM real si hay proveedor configurado; determinista solo en modo
   * demo) y lo persiste, sin generar todavia el HTML. No hay ningun borrador
   * previo ni aproximacion: esto puede gastar cuota de un proveedor real, y
   * es el paso explicito para revisar el prompt exacto antes de decidir si
   * generar.
   */
  const composeFinalPrompt = async () => {
    if (!project) return;
    setBusy('composing');
    setError(null);
    setNotice(null);

    const result = await apiPost<ComposePromptResult>('/api/prompts/compose', {
      projectId: project.id,
      providerId,
      model: model || undefined,
      designTechniques: techniqueIds,
    });

    if (!result.ok) {
      setError(result.error.message + (result.error.hint ? ` ${result.error.hint}` : ''));
      setBusy(null);
      return;
    }

    setBuilt(result.data.built);
    setPromptText(result.data.built.content);
    setEdited(false);
    setComposedVersionId(result.data.promptVersionId);
    setBusy(null);
  };

  const generate = async () => {
    if (!project || !composedVersionId) return;
    setBusy('generating');
    setError(null);
    setNotice(null);

    const result = await apiPost<GenerateLandingResult>('/api/generations', {
      projectId: project.id,
      // Genera a partir del prompt ya generado por "Generar prompt": el
      // servidor no vuelve a recomponerlo. Si el usuario edito el textarea
      // despues, se respeta su texto tal cual.
      promptVersionId: composedVersionId,
      promptContent: edited ? promptText : undefined,
      systemInstruction: edited ? built?.systemInstruction : undefined,
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

  /** Reintenta solo los marcadores de imagen que siguen pendientes (no gasta cuota en los demas). */
  const retryImages = async () => {
    if (!landing) return;
    setBusy('imaging');
    setError(null);
    setNotice(null);

    const result = await apiPost<RetryImagesResult>(`/api/landings/${landing.id}/images`, {});
    if (!result.ok) {
      setError(result.error.message);
      setBusy(null);
      return;
    }

    const { landing: next, images, changed } = result.data;
    setImageReport(images);
    if (changed) {
      setLanding(next);
      setNotice(`Se generaron ${images.generated} imagen(es) nuevas: ${images.ready} de ${images.total} listas.`);
    } else {
      setError(`No se pudo generar ninguna imagen nueva${images.reason ? `: ${images.reason}` : '.'}`);
    }
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
    setImageReport(data.images ?? null);
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
              El Prompt Engine parte del brief: publico, objetivo, stack y restricciones, y aplica solo las
              tecnicas de diseno que elijas.
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

          {/* `flex-wrap`: a 360 px los dos botones (sin salto de linea) no caben en una fila y
              ensanchaban toda la columna del Studio mas alla de su margen. */}
          <div className="flex flex-wrap items-end gap-2">
            <Button variant="secondary" onClick={() => void composeFinalPrompt()} loading={busy === 'composing'}>
              <Wand2 className="size-4" aria-hidden="true" />
              Generar prompt
            </Button>
            <Button
              variant="primary"
              onClick={generate}
              loading={generating}
              disabled={!composedVersionId || landingEditor.dirty}
              title={
                !composedVersionId
                  ? 'Genera el prompt primero'
                  : landingEditor.dirty
                    ? 'Guarda o descarta los cambios del codigo antes de generar otra pagina'
                    : undefined
              }
              className="flex-1"
            >
              <Play className="size-4" aria-hidden="true" />
              Generar HTML
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

      {composeFallback ? (
        <Alert tone="warn" title="El prompt no lo compuso el LLM">
          {provider?.label ?? 'El proveedor'} no pudo reescribir el prompt (limite de cuota, fallo
          transitorio o formato invalido) y se uso el borrador determinista como red de seguridad.
          Este prompt es valido
          {built?.seedStringValue ? ', pero no tiene la Seed aplicada por el modelo' : ''}. Pulsa
          &quot;Generar prompt&quot; de nuevo para reintentarlo con el LLM real. Solo incluye las
          tecnicas que elegiste.
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="ok">{notice}</Alert> : null}

      {/* Prompt | Preview */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* `min-w-0` en las dos columnas: por debajo de `xl` la cuadricula es de una sola columna
            y, sin el, las lineas largas del editor ensanchan la pista y toda la pagina se
            desborda horizontalmente. */}
        <Panel className="flex min-w-0 flex-col">
          <PanelHeader
            eyebrow="Prompt"
            title={
              <span className="flex items-center gap-2">
                Prompt
                {composedVersionId && !edited && !composeFallback ? <Badge tone="ok">generado</Badge> : null}
                {composeFallback && !edited ? <Badge tone="warn">borrador (sin LLM)</Badge> : null}
                {edited ? <Badge tone="warn">editado</Badge> : null}
              </span>
            }
            description={
              built
                ? `${built.sections.length} secciones · ~${estimateTokens(promptText).toLocaleString('es-ES')} tokens`
                : busy === 'composing'
                  ? 'Generando...'
                  : 'Pulsa "Generar prompt" para verlo aqui.'
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
                  Prompt enviado al modelo
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
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 p-3">
                <EditorAlerts editor={landingEditor} />
                <div className="border border-line">
                  <EditorToolbar
                    editor={landingEditor}
                    cursor={inspector.cursor}
                    onGoto={inspector.openGotoLine}
                  />
                  <HtmlCodeEditor
                    value={landingEditor.draft}
                    onChange={landingEditor.setDraft}
                    onSave={() => void landingEditor.save()}
                    label="Codigo HTML de la Landing Page generada"
                    className="h-[clamp(360px,52vh,640px)] border-0"
                    {...inspector.editorProps}
                  />
                </div>
                <p className="text-xs text-muted">
                  Ctrl+S guarda una version nueva &middot; usa &quot;Inspeccionar&quot; en la vista previa para saltar
                  a la linea de un elemento.
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <Button size="sm" onClick={copyPrompt}>
              <Copy className="size-3.5" aria-hidden="true" />
              Copiar prompt
            </Button>
            {edited && built ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Vuelve al prompt ya generado, sin gastar otra llamada.
                  setPromptText(built.content);
                  setEdited(false);
                }}
              >
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

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <LandingPreview
            html={previewHtml}
            generating={generating || busy === 'imaging'}
            generatingLabel={
              busy === 'imaging'
                ? 'Generando imagenes...'
                : busy === 'generating' && promptText.includes(IMAGE_ATTR)
                  ? 'Generando HTML e imagenes...'
                  : undefined
            }
            {...inspector.previewProps}
          />

          {landing ? <InspectorPanel sync={inspector} /> : null}

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
                  {imageReport && imageReport.total > 0 ? (
                    <Badge tone={imageReport.pending === 0 ? 'ok' : 'warn'}>
                      Imagenes {imageReport.ready}/{imageReport.total}
                    </Badge>
                  ) : null}
                </div>

                {imageReport && imageReport.pending > 0 && landing ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>
                      {imageReport.pending} imagen(es) sin generar
                      {imageReport.reason ? `: ${imageReport.reason}` : '.'}
                    </span>
                    <Button
                      size="sm"
                      onClick={retryImages}
                      loading={busy === 'imaging'}
                      disabled={landingEditor.dirty}
                      title={landingEditor.dirty ? 'Guarda o descarta los cambios de codigo antes de reintentar.' : undefined}
                    >
                      <ImagePlus className="size-3.5" aria-hidden="true" />
                      Reintentar imagenes
                    </Button>
                  </div>
                ) : null}

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
      {landing && landingEditor.dirty ? (
        <Alert tone="warn" title="Hay cambios de codigo sin guardar">
          El critico, el refinamiento y las variantes trabajan sobre la version guardada, no sobre lo que estas
          editando. Guarda los cambios (Ctrl+S en la pestana Codigo) o descartalos antes de usarlos.
        </Alert>
      ) : null}
      {landing ? (
        <CriticPanel
          locked={landingEditor.dirty}
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
                        {technique.id === 'image-generation' && checked && !imageGenerationConfigured ? (
                          <span className="mt-1 block text-xs text-warn">
                            Cloudflare no esta configurado: la pagina llevara marcadores con la descripcion de cada
                            imagen, sin generarlas.{' '}
                            <Link href="/settings" className="text-accent underline underline-offset-2">
                              Configurar
                            </Link>
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </PanelBody>
        </Panel>

        <div className="grid gap-4">

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
                <Button
                  onClick={makeVariation}
                  loading={busy === 'varying'}
                  disabled={landingEditor.dirty}
                  title={landingEditor.dirty ? 'Guarda o descarta los cambios del codigo primero.' : undefined}
                >
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
