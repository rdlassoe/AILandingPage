import 'server-only';

import type { DataStore } from '@/lib/data/types';
import { AppException, notFound } from '@/lib/errors';
import { truncate } from '@/lib/utils';
import { runLLM } from '@/services/llm-orchestrator';
import { validateLandingOutput } from '@/services/output-validator';
import { buildLandingPrompt, DEFAULT_TECHNIQUE_IDS, generatedSeedResolution } from '@/services/prompt-engine';
import { VARIATION_STRATEGIES, type Generation, type LandingPage, type Project, type PromptSectionId } from '@/types/domain';
import type { LLMGenerationConfig, ProviderId } from '@/types/llm';
import type {
  BuiltPrompt,
  GenerateLandingInput,
  GenerateLandingResult,
  RefineInput,
  VariationInput,
} from '@/types/services';

/**
 * Landing Generator
 *
 * Implementa el flujo completo descrito en el documento de requisitos:
 * validar proyecto -> construir contexto -> aplicar Seed -> aplicar tecnicas ->
 * aplicar restricciones -> construir prompt -> seleccionar proveedor ->
 * enviar -> normalizar -> validar HTML -> guardar version -> devolver preview.
 *
 * Cada paso queda registrado en la tabla `generations` para poder diagnosticar
 * que ocurrio (proveedor, modelo, latencia, estado, avisos del validador).
 */

export interface GenerationContext {
  ownerId: string;
  store: DataStore;
}

/** Paso 1-6: reconstruye el prompt canonico del proyecto. */
export async function buildPromptForProject(
  ctx: GenerationContext,
  project: Project,
  options: { customSeedValue?: string | null } = {},
): Promise<BuiltPrompt> {
  const technologies = await ctx.store.getTechnologiesByIds(project.technical.technologyIds);
  const seed = project.seedStringId ? await ctx.store.getSeed(project.seedStringId) : null;

  return buildLandingPrompt({
    project,
    technologies,
    seed,
    customSeedValue: options.customSeedValue ?? project.seedStringValue,
    negativeConstraints: project.negativeConstraints,
    designTechniques: DEFAULT_TECHNIQUE_IDS,
    discover: project.discover,
    define: project.define,
  });
}

/**
 * Secciones del encargo que se repiten al refinar o al generar una variante.
 *
 * Incrustar el prompt completo de 17 secciones duplicaba el tamano de la
 * peticion sin aportar: el stack, la arquitectura de informacion y los
 * criterios de calidad ya estan encarnados en el HTML que se envia junto al
 * encargo. Lo que si hay que repetir es el contexto que el modelo necesita
 * para no perder el hilo y, sobre todo, las restricciones que podria violar
 * al reescribir.
 *
 * Medido: reduce una peticion de refinamiento de ~10 300 a ~5 100 tokens, que
 * es la diferencia entre caber o no en el limite por peticion de una capa
 * gratuita (Groq devuelve 413 por encima de 8 000).
 *
 * El orden y los titulos se conservan porque el Mock Provider reconstruye el
 * brief leyendo estas mismas cabeceras.
 */
const BRIEF_SECTIONS: PromptSectionId[] = [
  'CONTEXT',
  'TARGET_AUDIENCE',
  'BUSINESS_GOAL',
  'VISUAL_DIRECTION',
  'SEED_STRING',
  'COPY_REQUIREMENTS',
  'NEGATIVE_CONSTRAINTS',
];

function renderBrief(built: BuiltPrompt): string {
  const sections = built.sections.filter((section) => BRIEF_SECTIONS.includes(section.id));
  if (sections.length === 0) return built.content;
  return sections.map((section) => `## ${section.title}\n${section.body}`).join('\n\n');
}

export async function generateLanding(
  ctx: GenerationContext,
  input: GenerateLandingInput,
): Promise<GenerateLandingResult> {
  // Paso 1: validar proyecto
  const project = await ctx.store.getProject(ctx.ownerId, input.projectId);
  if (!project) throw notFound('ese proyecto');
  assertProjectIsGeneratable(project);

  // Pasos 2-6: construir el prompt canonico
  const built = await buildPromptForProject(ctx, project);

  const promptContent = input.promptContent?.trim() || built.content;
  const systemInstruction = input.systemInstruction?.trim() || built.systemInstruction;
  const edited = promptContent !== built.content;

  // Persistencia del prompt y de su version (trazabilidad landing <-> prompt)
  const prompt = await ensurePrompt(ctx, project, input.promptId, built);
  const promptVersion = await ctx.store.createPromptVersion(ctx.ownerId, {
    promptId: prompt.id,
    content: promptContent,
    systemInstruction,
    sections: built.sections,
    technologyIds: built.technologyIds,
    seedStringValue: built.seedStringValue,
    negativeConstraints: built.negativeConstraints,
    conflicts: built.conflicts,
    providerId: input.providerId ?? null,
    model: input.model ?? null,
    config: (input.config as LLMGenerationConfig | undefined) ?? null,
    changeNote: edited ? 'Prompt editado manualmente en el Prompt Studio' : 'Prompt generado por el Prompt Engine',
  });

  return runGeneration(ctx, {
    project,
    promptId: prompt.id,
    promptVersionId: promptVersion.id,
    system: systemInstruction,
    prompt: promptContent,
    providerId: input.providerId,
    model: input.model,
    config: input.config,
    kind: 'landing',
    label: input.label ?? 'Generacion inicial',
    allowCache: input.allowCache ?? false,
    technologyIds: built.technologyIds,
    seedStringValue: built.seedStringValue,
    existingLandingId: null,
  });
}

export async function refineLanding(
  ctx: GenerationContext,
  input: RefineInput,
): Promise<GenerateLandingResult> {
  const landing = await ctx.store.getLandingPage(ctx.ownerId, input.landingPageId);
  if (!landing || landing.ownerId !== ctx.ownerId) throw notFound('esa Landing Page');

  const project = landing.projectId ? await ctx.store.getProject(ctx.ownerId, landing.projectId) : null;
  if (!project) throw notFound('el proyecto asociado a esa Landing Page');

  const review = input.reviewId ? await ctx.store.getReview(ctx.ownerId, input.reviewId) : null;
  const accepted = new Set(input.acceptedSuggestionIds);
  const changes = (review?.suggestions ?? [])
    .filter((suggestion) => accepted.has(suggestion.id))
    .map((suggestion, index) => `${index + 1}. ${suggestion.title}: ${suggestion.action}`);

  if (changes.length === 0 && !input.extraInstructions?.trim()) {
    throw new AppException({
      code: 'validation',
      message: 'Selecciona al menos una recomendacion o escribe instrucciones para refinar.',
    });
  }

  const built = await buildPromptForProject(ctx, project);

  const refinementPrompt = [
    'Vas a corregir una Landing Page existente.',
    '',
    '## ENCARGO ORIGINAL',
    renderBrief(built),
    '',
    '## VERSION ACTUAL',
    landing.html,
    '',
    '## CAMBIOS QUE DEBES APLICAR',
    changes.length > 0 ? changes.join('\n') : '(ninguno seleccionado)',
    '',
    '## INSTRUCCIONES ADICIONALES DEL USUARIO',
    input.extraInstructions?.trim() || '(ninguna)',
    '',
    '## REGLAS DEL REFINAMIENTO',
    '- Aplica exactamente los cambios listados. No rediseñes lo que no se menciona.',
    '- Conserva el contenido, el tono y la identidad visual que ya funcionaban.',
    '- No introduzcas dependencias ni secciones nuevas que nadie ha pedido.',
    '- Devuelve el documento HTML completo y autocontenido, no un fragmento ni un diff.',
    '- Primera linea: <!DOCTYPE html>. Ultima linea: </html>. Sin markdown.',
  ].join('\n');

  const promptVersion = await ctx.store.createPromptVersion(ctx.ownerId, {
    promptId: landing.promptId ?? (await ensurePrompt(ctx, project, undefined, built)).id,
    content: refinementPrompt,
    systemInstruction: built.systemInstruction,
    sections: built.sections,
    technologyIds: built.technologyIds,
    seedStringValue: built.seedStringValue,
    negativeConstraints: built.negativeConstraints,
    conflicts: built.conflicts,
    providerId: input.providerId ?? null,
    model: input.model ?? null,
    config: null,
    changeNote: `Refinamiento con ${changes.length} recomendacion(es) aceptada(s)`,
  });

  return runGeneration(ctx, {
    project,
    promptId: promptVersion.promptId,
    promptVersionId: promptVersion.id,
    system: built.systemInstruction,
    prompt: refinementPrompt,
    providerId: input.providerId,
    model: input.model,
    kind: 'refinement',
    label: `Refinamiento v${landing.currentVersion + 1}`,
    allowCache: false,
    technologyIds: landing.technologyIds,
    seedStringValue: landing.metadata.seedStringValue,
    existingLandingId: landing.id,
  });
}

export async function generateVariation(
  ctx: GenerationContext,
  input: VariationInput,
): Promise<GenerateLandingResult> {
  const landing = await ctx.store.getLandingPage(ctx.ownerId, input.landingPageId);
  if (!landing || landing.ownerId !== ctx.ownerId) throw notFound('esa Landing Page');

  const project = landing.projectId ? await ctx.store.getProject(ctx.ownerId, landing.projectId) : null;
  if (!project) throw notFound('el proyecto asociado a esa Landing Page');

  const strategy = VARIATION_STRATEGIES.find((item) => item.id === input.strategy);
  if (!strategy) throw new AppException({ code: 'validation', message: 'Estrategia de variacion desconocida.' });

  // Estrategia SSoT: para "mismo contenido, nueva Seed" se genera una Seed
  // interna que diversifica la salida sin mostrarsela al usuario.
  const useNewSeed = input.strategy === 'same-content-new-seed' || input.strategy === 'experimental';
  const seedResolution = useNewSeed ? generatedSeedResolution() : null;

  const built = await buildPromptForProject(ctx, project, {
    customSeedValue: seedResolution?.value ?? project.seedStringValue,
  });

  const variationPrompt = [
    'Vas a producir una VARIANTE de una Landing Page existente.',
    '',
    '## ENCARGO ORIGINAL',
    renderBrief(built),
    '',
    '## VERSION ACTUAL',
    landing.html,
    '',
    `## ESTRATEGIA DE VARIACION: ${strategy.label}`,
    strategy.description,
    '',
    '## NOTAS DEL USUARIO',
    input.notes?.trim() || '(ninguna)',
    '',
    '## REGLAS',
    '- La variante debe ser reconociblemente distinta, no un ajuste cosmetico.',
    '- Manten la calidad, la accesibilidad y las restricciones negativas del encargo original.',
    '- Devuelve el documento HTML completo y autocontenido.',
    '- Primera linea: <!DOCTYPE html>. Ultima linea: </html>. Sin markdown.',
  ].join('\n');

  const promptVersion = await ctx.store.createPromptVersion(ctx.ownerId, {
    promptId: landing.promptId ?? (await ensurePrompt(ctx, project, undefined, built)).id,
    content: variationPrompt,
    systemInstruction: built.systemInstruction,
    sections: built.sections,
    technologyIds: built.technologyIds,
    seedStringValue: built.seedStringValue,
    negativeConstraints: built.negativeConstraints,
    conflicts: built.conflicts,
    providerId: input.providerId ?? null,
    model: input.model ?? null,
    config: null,
    changeNote: `Variante: ${strategy.label}`,
  });

  return runGeneration(ctx, {
    project,
    promptId: promptVersion.promptId,
    promptVersionId: promptVersion.id,
    system: built.systemInstruction,
    prompt: variationPrompt,
    providerId: input.providerId,
    model: input.model,
    kind: 'variation',
    label: strategy.label,
    allowCache: false,
    technologyIds: landing.technologyIds,
    seedStringValue: built.seedStringValue,
    // Una variante es una Landing Page nueva, no una version de la anterior.
    existingLandingId: null,
    nameSuffix: strategy.label,
  });
}

/* -------------------------------------------------------------------------
 * Nucleo compartido
 * ---------------------------------------------------------------------- */

interface RunGenerationInput {
  project: Project;
  promptId: string;
  promptVersionId: string;
  system: string;
  prompt: string;
  providerId?: ProviderId;
  model?: string;
  config?: Partial<LLMGenerationConfig>;
  kind: Generation['kind'];
  label: string;
  allowCache: boolean;
  technologyIds: string[];
  seedStringValue: string | null;
  /** Si viene, la salida se guarda como nueva version de esa Landing Page. */
  existingLandingId: string | null;
  nameSuffix?: string;
}

async function runGeneration(
  ctx: GenerationContext,
  input: RunGenerationInput,
): Promise<GenerateLandingResult> {
  const generation = await ctx.store.createGeneration(ctx.ownerId, {
    projectId: input.project.id,
    promptId: input.promptId,
    promptVersionId: input.promptVersionId,
    kind: input.kind,
    providerId: input.providerId ?? 'mock',
    model: input.model ?? '',
    status: 'pending',
    isMock: false,
    latencyMs: 0,
    inputTokens: null,
    outputTokens: null,
    errorCode: null,
    errorMessage: null,
    warnings: [],
    landingPageId: null,
    config: null,
    cacheKey: null,
    servedFromCache: false,
  });

  try {
    // Pasos 7-9: proveedor, envio y normalizacion de la respuesta
    const outcome = await runLLM({
      ownerId: ctx.ownerId,
      system: input.system,
      prompt: input.prompt,
      providerId: input.providerId,
      model: input.model,
      config: input.config,
    });

    // Paso 10: validacion del HTML
    const validation = validateLandingOutput(outcome.text);
    const warnings = validation.issues.filter((i) => i.severity === 'warning').map((i) => i.message);

    if (!validation.valid) {
      const errors = validation.issues.filter((i) => i.severity === 'error');
      await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
        status: 'invalid_output',
        providerId: outcome.providerId,
        model: outcome.model,
        isMock: outcome.isMock,
        latencyMs: outcome.latencyMs,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        errorCode: 'invalid_output',
        errorMessage: errors.map((e) => e.message).join(' '),
        warnings,
        cacheKey: outcome.cacheKey,
      });

      throw new AppException({
        code: 'invalid_output',
        message: 'El modelo no devolvio una Landing Page utilizable.',
        detail: errors.map((e) => e.message).join(' '),
        hint: 'Prueba a simplificar el prompt, a reducir el numero de secciones o a cambiar de modelo.',
        retryable: true,
      });
    }

    // Pasos 11 y 15: guardar la Landing Page y su version
    const landing = await persistLanding(ctx, {
      ...input,
      generationId: generation.id,
      providerId: outcome.providerId,
      model: outcome.model,
      isMock: outcome.isMock,
      validation,
    });

    await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
      status: 'success',
      providerId: outcome.providerId,
      model: outcome.model,
      isMock: outcome.isMock,
      latencyMs: outcome.latencyMs,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      warnings,
      landingPageId: landing.id,
      cacheKey: outcome.cacheKey,
      servedFromCache: outcome.servedFromCache,
    });

    if (input.project.status === 'draft' || input.project.status === 'defined') {
      await ctx.store.updateProject(ctx.ownerId, input.project.id, { status: 'generated' });
    }

    return {
      landingPage: landing,
      generationId: generation.id,
      promptVersionId: input.promptVersionId,
      validation,
      isMock: outcome.isMock,
      providerId: outcome.providerId,
      model: outcome.model,
      latencyMs: outcome.latencyMs,
      servedFromCache: outcome.servedFromCache,
    };
  } catch (error) {
    const appError = error instanceof AppException ? error : null;
    const status = resolveFailureStatus(error);

    if (status !== 'invalid_output') {
      await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
        status,
        errorCode: appError?.code ?? 'unknown',
        errorMessage: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
    throw error;
  }
}

function resolveFailureStatus(error: unknown): Generation['status'] {
  if (error instanceof AppException) {
    if (error.code === 'rate_limited') return 'rate_limited';
    if (error.code === 'timeout') return 'timeout';
    if (error.code === 'invalid_output') return 'invalid_output';
  }
  return 'error';
}

interface PersistLandingInput extends RunGenerationInput {
  generationId: string;
  providerId: ProviderId;
  model: string;
  isMock: boolean;
  validation: ReturnType<typeof validateLandingOutput>;
}

async function persistLanding(ctx: GenerationContext, input: PersistLandingInput): Promise<LandingPage> {
  const metadata = {
    sections: input.validation.sections,
    seedStringValue: input.seedStringValue,
    sizeBytes: input.validation.sizeBytes,
    hasScript: input.validation.hasScript,
    hasStyle: input.validation.hasStyle,
    criticScore: null,
  };

  if (input.existingLandingId) {
    const updated = await ctx.store.updateLandingPage(ctx.ownerId, input.existingLandingId, {
      html: input.validation.html,
      description: input.validation.description,
      generationId: input.generationId,
      promptVersionId: input.promptVersionId,
      providerId: input.providerId,
      model: input.model,
      isMock: input.isMock,
      metadata,
    });

    await ctx.store.createLandingVersion(ctx.ownerId, {
      landingPageId: updated.id,
      html: input.validation.html,
      label: input.label,
      generationId: input.generationId,
      promptVersionId: input.promptVersionId,
    });

    return (await ctx.store.getLandingPage(ctx.ownerId, updated.id)) ?? updated;
  }

  const baseName = input.validation.title || input.project.basics.name;
  const name = input.nameSuffix ? `${truncate(baseName, 50)} — ${input.nameSuffix}` : truncate(baseName, 70);

  const landing = await ctx.store.createLandingPage(ctx.ownerId, {
    projectId: input.project.id,
    promptId: input.promptId,
    promptVersionId: input.promptVersionId,
    generationId: input.generationId,
    name,
    description: input.validation.description,
    html: input.validation.html,
    technologyIds: input.technologyIds,
    providerId: input.providerId,
    model: input.model,
    isMock: input.isMock,
    status: 'private',
    category: input.project.basics.landingType,
    metadata,
  });

  await ctx.store.createLandingVersion(ctx.ownerId, {
    landingPageId: landing.id,
    html: input.validation.html,
    label: input.label,
    generationId: input.generationId,
    promptVersionId: input.promptVersionId,
  });

  return landing;
}

async function ensurePrompt(
  ctx: GenerationContext,
  project: Project,
  promptId: string | undefined,
  built: BuiltPrompt,
) {
  if (promptId) {
    const existing = await ctx.store.getPrompt(ctx.ownerId, promptId);
    if (existing) return existing;
  }

  const existingForProject = await ctx.store.listPrompts(ctx.ownerId, { projectId: project.id, limit: 1 });
  const first = existingForProject[0];
  if (first) return first;

  return ctx.store.createPrompt(ctx.ownerId, {
    projectId: project.id,
    name: `Prompt de ${project.basics.name}`,
    description: `Generado por el Prompt Engine para ${project.basics.theme}`,
    technologyIds: built.technologyIds,
    tags: [project.basics.landingType],
  });
}

function assertProjectIsGeneratable(project: Project): void {
  const missing: string[] = [];
  if (!project.basics.name?.trim()) missing.push('nombre');
  if (!project.basics.description?.trim()) missing.push('descripcion');
  if (!project.basics.targetAudience?.trim()) missing.push('publico objetivo');
  if (!project.basics.primaryCta?.trim()) missing.push('CTA principal');

  if (missing.length > 0) {
    throw new AppException({
      code: 'validation',
      message: `Completa estos campos del proyecto antes de generar: ${missing.join(', ')}.`,
    });
  }
}
