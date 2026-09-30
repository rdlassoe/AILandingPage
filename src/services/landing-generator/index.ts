import 'server-only';

import type { DataStore } from '@/lib/data/types';
import { AppException, notFound } from '@/lib/errors';
import { truncate } from '@/lib/utils';
import { resolveProvider } from '@/lib/llm/registry';
import { runLLM } from '@/services/llm-orchestrator';
import { validateLandingOutput } from '@/services/output-validator';
import {
  buildLandingPrompt,
  composePromptViaLLM,
  DEFAULT_SYSTEM_INSTRUCTION,
  DEFAULT_TECHNIQUE_IDS,
  generateRandomSeedForMock,
  generateRandomSeedString,
  renderSeedBlock,
} from '@/services/prompt-engine';
import {
  VARIATION_STRATEGIES,
  type Generation,
  type LandingPage,
  type Project,
  type PromptSection,
  type PromptSectionId,
} from '@/types/domain';
import type { LLMGenerationConfig, ProviderId } from '@/types/llm';
import type {
  BuiltPrompt,
  ComposePromptInput,
  ComposePromptResult,
  DesignTechniqueId,
  GenerateLandingInput,
  GenerateLandingResult,
  RandomSeedResult,
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

/**
 * Paso 1-6: compone el prompt canonico del proyecto.
 *
 * La Seed ya no es una eleccion del proyecto: es un string aleatorio nuevo
 * en CADA ejecucion (tecnica String Seed of Thought). Con un proveedor real
 * lo genera un LLM (`generateRandomSeedString`); en modo demo, o si el
 * proveedor pedido no esta configurado y acabara degradando a demo,
 * `generateRandomSeedForMock` hace lo mismo con `crypto.randomBytes`, sin
 * LLM.
 *
 * Con el modo demo, el prompt en si sigue siendo el que produce
 * `buildLandingPrompt`: una funcion de codigo, determinista y gratuita (la
 * Seed es lo unico que varia entre ejecuciones). Con un proveedor real,
 * `composePromptViaLLM` ademas reescribe ese borrador entero como el prompt
 * final de 17 secciones, manipulando el string aleatorio para derivar la
 * direccion creativa.
 *
 * Si la composicion falla o el modelo no respeta el formato, se cae al
 * borrador determinista: nunca se deja al usuario sin prompt.
 */
export async function buildPromptForProject(
  ctx: GenerationContext,
  project: Project,
  options: { providerId?: ProviderId; model?: string; designTechniques?: DesignTechniqueId[] } = {},
): Promise<BuiltPrompt> {
  const technologies = await ctx.store.getTechnologiesByIds(project.technical.technologyIds);

  // `resolveProvider` es la MISMA funcion que usara el orquestador al
  // ejecutar de verdad: si el proveedor pedido no esta configurado, aqui
  // tambien se trata como demo. Evita mandarle al Mock Provider un prompt de
  // "genera un string aleatorio" o "reescribe este prompt": Mock interpreta
  // el texto para decidir que responder, y esas formas no las reconoce.
  const { provider } = resolveProvider(options.providerId);
  const usesRealLLM = provider.id !== 'mock';

  const seed = usesRealLLM
    ? await generateRandomSeedWithTracking(ctx, project, options)
    : generateRandomSeedForMock();

  const draft = buildLandingPrompt({
    project,
    technologies,
    randomSeedString: seed.randomString,
    negativeConstraints: project.negativeConstraints,
    designTechniques: options.designTechniques ?? DEFAULT_TECHNIQUE_IDS,
    discover: project.discover,
    define: project.define,
  });

  if (!usesRealLLM) return draft;

  const generation = await ctx.store.createGeneration(ctx.ownerId, {
    projectId: project.id,
    promptId: null,
    promptVersionId: null,
    kind: 'prompt_generation',
    providerId: options.providerId ?? 'mock',
    model: options.model ?? '',
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
    const composed = await composePromptViaLLM(
      { ownerId: ctx.ownerId, providerId: options.providerId, model: options.model },
      draft,
    );
    await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
      status: 'success',
      providerId: composed.providerId,
      model: composed.model,
      isMock: composed.isMock,
      latencyMs: composed.latencyMs,
      inputTokens: composed.inputTokens,
      outputTokens: composed.outputTokens,
      cacheKey: composed.cacheKey,
    });
    return composed.built;
  } catch (error) {
    await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
      status: 'error',
      errorCode: 'prompt_generation_failed',
      errorMessage: error instanceof Error ? error.message : 'Error desconocido',
    });
    // Red de seguridad: el borrador determinista sigue siendo un prompt
    // valido y completo, solo que no lo redacto el LLM.
    return draft;
  }
}

/**
 * Compone el prompt final del proyecto (igual que `buildPromptForProject`) y
 * lo persiste como `prompt_version`, sin generar todavia ninguna Landing
 * Page. Permite mostrarle al usuario el prompt REAL (con LLM si aplica) antes
 * de gastar la llamada, mas cara, que genera el HTML.
 *
 * `generateLanding` puede recibir el `promptVersionId` que esto devuelve para
 * saltarse la composicion y generar directo a partir de el.
 */
export async function composeAndPersistPrompt(
  ctx: GenerationContext,
  input: ComposePromptInput,
): Promise<ComposePromptResult> {
  const project = await ctx.store.getProject(ctx.ownerId, input.projectId);
  if (!project) throw notFound('ese proyecto');
  assertProjectIsGeneratable(project);

  const built = await buildPromptForProject(ctx, project, {
    providerId: input.providerId,
    model: input.model,
    designTechniques: input.designTechniques,
  });
  const prompt = await ensurePrompt(ctx, project, input.promptId, built.technologyIds);

  const promptVersion = await ctx.store.createPromptVersion(ctx.ownerId, {
    promptId: prompt.id,
    content: built.content,
    systemInstruction: built.systemInstruction,
    sections: built.sections,
    technologyIds: built.technologyIds,
    seedStringValue: built.seedStringValue,
    negativeConstraints: built.negativeConstraints,
    conflicts: built.conflicts,
    providerId: input.providerId ?? null,
    model: input.model ?? null,
    config: null,
    changeNote: 'Prompt generado por el Prompt Engine',
  });

  return { built, promptId: prompt.id, promptVersionId: promptVersion.id };
}

/** Envuelve `generateRandomSeedString` dejando registro en `generations` (kind: 'seed'). */
async function generateRandomSeedWithTracking(
  ctx: GenerationContext,
  project: Project,
  options: { providerId?: ProviderId; model?: string },
): Promise<RandomSeedResult> {
  const generation = await ctx.store.createGeneration(ctx.ownerId, {
    projectId: project.id,
    promptId: null,
    promptVersionId: null,
    kind: 'seed',
    providerId: options.providerId ?? 'mock',
    model: options.model ?? '',
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
    const { result, ...outcome } = await generateRandomSeedString({
      ownerId: ctx.ownerId,
      providerId: options.providerId,
      model: options.model,
    });
    await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
      status: 'success',
      providerId: outcome.providerId,
      model: outcome.model,
      isMock: result.isMock,
      latencyMs: outcome.latencyMs,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      cacheKey: outcome.cacheKey,
    });
    return result;
  } catch (error) {
    await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
      status: 'error',
      errorCode: 'seed_generation_failed',
      errorMessage: error instanceof Error ? error.message : 'Error desconocido',
    });
    // Red de seguridad: cualquier string aleatorio sirve como fuente de
    // entropia para la tecnica SSoT — si el LLM falla, el PRNG del servidor
    // (crypto.randomBytes) cubre el mismo papel sin dejar la Seed vacia.
    return generateRandomSeedForMock();
  }
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
 *
 * IMPORTANTE: el brief se extrae de las `sections` YA GUARDADAS en la
 * `prompt_version` de la Landing Page que se esta refinando o variando —
 * nunca recomponiendo el prompt de nuevo. Desde que el prompt lo puede
 * escribir un LLM, volver a componerlo dana dos veces: gasta dos llamadas
 * mas solo para extraer un fragmento, y como ya no es determinista, el
 * brief podria no coincidir con el que realmente produjo el HTML actual.
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

function renderBrief(sections: PromptSection[], fallbackContent: string): string {
  const filtered = sections.filter((section) => BRIEF_SECTIONS.includes(section.id));
  if (filtered.length === 0) return fallbackContent;
  return filtered.map((section) => `## ${section.title}\n${section.body}`).join('\n\n');
}

/** Version del prompt que produjo la Landing Page actual, si sigue existiendo. */
async function getSourcePromptVersion(ctx: GenerationContext, landing: LandingPage) {
  if (!landing.promptVersionId) return null;
  return ctx.store.getPromptVersion(ctx.ownerId, landing.promptVersionId);
}

export async function generateLanding(
  ctx: GenerationContext,
  input: GenerateLandingInput,
): Promise<GenerateLandingResult> {
  // Paso 1: validar proyecto
  const project = await ctx.store.getProject(ctx.ownerId, input.projectId);
  if (!project) throw notFound('ese proyecto');
  assertProjectIsGeneratable(project);

  // Camino nuevo: el prompt ya se compuso y persistio de antemano (Prompt
  // Studio: "Componer prompt final") via `composeAndPersistPrompt`. Se genera
  // directo a partir de esa version, sin recomponer nada. `promptId` se
  // deriva de la propia version, asi que compositor y generador quedan
  // atados al mismo Prompt sin volver a invocar `ensurePrompt`.
  if (input.promptVersionId) {
    const existing = await ctx.store.getPromptVersion(ctx.ownerId, input.promptVersionId);
    if (!existing) throw notFound('esa version de prompt');

    const promptContent = input.promptContent?.trim() || existing.content;
    const systemInstruction = input.systemInstruction?.trim() || existing.systemInstruction;
    const edited = promptContent !== existing.content;

    const version = edited
      ? await ctx.store.createPromptVersion(ctx.ownerId, {
          promptId: existing.promptId,
          content: promptContent,
          systemInstruction,
          sections: existing.sections,
          technologyIds: existing.technologyIds,
          seedStringValue: existing.seedStringValue,
          negativeConstraints: existing.negativeConstraints,
          conflicts: existing.conflicts,
          providerId: input.providerId ?? null,
          model: input.model ?? null,
          config: (input.config as LLMGenerationConfig | undefined) ?? null,
          changeNote: 'Prompt editado manualmente en el Prompt Studio',
        })
      : existing;

    return runGeneration(ctx, {
      project,
      promptId: version.promptId,
      promptVersionId: version.id,
      system: systemInstruction,
      prompt: promptContent,
      providerId: input.providerId,
      model: input.model,
      config: input.config,
      kind: 'landing',
      label: input.label ?? 'Generacion desde el Prompt Engine',
      allowCache: input.allowCache ?? false,
      technologyIds: version.technologyIds,
      seedStringValue: version.seedStringValue,
      existingLandingId: null,
    });
  }

  // Camino actual (compatibilidad): sin promptVersionId, compone y genera en
  // la misma llamada. Sin cambios.
  //
  // Pasos 2-6: construir el prompt canonico. Se calcula aunque el usuario
  // haya editado el prompt a mano (ver mas abajo): ademas del texto, aporta
  // metadatos que se guardan con la version (stack resuelto, Seed, secciones).
  // Nota de coste: si el usuario edito el prompt, esas dos llamadas al LLM
  // (Seed + composicion) se gastan solo para esos metadatos, no para el
  // texto final. Es un coste conocido, no un error.
  const built = await buildPromptForProject(ctx, project, { providerId: input.providerId, model: input.model });

  const promptContent = input.promptContent?.trim() || built.content;
  const systemInstruction = input.systemInstruction?.trim() || built.systemInstruction;
  const edited = promptContent !== built.content;

  // Persistencia del prompt y de su version (trazabilidad landing <-> prompt)
  const prompt = await ensurePrompt(ctx, project, input.promptId, built.technologyIds);
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
    // buildPromptForProject, arriba, ya hizo 1-2 llamadas reales (Seed +
    // composicion) segundos antes: sin esto, esta tercera llamada caia casi
    // siempre en el enfriamiento.
    skipCooldown: true,
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

  // El brief sale de la version guardada que realmente produjo `landing.html`,
  // no de recomponer el prompt de nuevo (ver nota en `getSourcePromptVersion`).
  const sourceVersion = await getSourcePromptVersion(ctx, landing);
  const systemInstruction = sourceVersion?.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;

  const refinementPrompt = [
    'Vas a corregir una Landing Page existente.',
    '',
    '## ENCARGO ORIGINAL',
    renderBrief(sourceVersion?.sections ?? [], landing.html),
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
    promptId: landing.promptId ?? (await ensurePrompt(ctx, project, undefined, landing.technologyIds)).id,
    content: refinementPrompt,
    systemInstruction,
    sections: sourceVersion?.sections ?? [],
    technologyIds: landing.technologyIds,
    seedStringValue: landing.metadata.seedStringValue,
    negativeConstraints: sourceVersion?.negativeConstraints ?? project.negativeConstraints,
    conflicts: sourceVersion?.conflicts ?? [],
    providerId: input.providerId ?? null,
    model: input.model ?? null,
    config: null,
    changeNote: `Refinamiento con ${changes.length} recomendacion(es) aceptada(s)`,
  });

  return runGeneration(ctx, {
    project,
    promptId: promptVersion.promptId,
    promptVersionId: promptVersion.id,
    system: systemInstruction,
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

  // Estrategia SSoT: para "mismo contenido, nueva Seed" se genera un nuevo
  // string aleatorio (con la tecnica real si el proveedor esta configurado,
  // o su equivalente PRNG en modo demo) que sustituye al del encargo original.
  const useNewSeed = input.strategy === 'same-content-new-seed' || input.strategy === 'experimental';
  const { provider } = resolveProvider(input.providerId);
  const freshSeed = useNewSeed
    ? provider.id !== 'mock'
      ? await generateRandomSeedWithTracking(ctx, project, { providerId: input.providerId, model: input.model })
      : generateRandomSeedForMock()
    : null;

  // El brief sale de la version guardada que realmente produjo `landing.html`
  // (misma razon que en `refineLanding`): recomponerlo de nuevo costaria dos
  // llamadas mas y podria no coincidir con lo que de verdad genero el HTML.
  const sourceVersion = await getSourcePromptVersion(ctx, landing);
  const systemInstruction = sourceVersion?.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
  const seedStringValue = freshSeed?.randomString ?? landing.metadata.seedStringValue;

  const variationPrompt = [
    'Vas a producir una VARIANTE de una Landing Page existente.',
    '',
    '## ENCARGO ORIGINAL',
    renderBrief(sourceVersion?.sections ?? [], landing.html),
    ...(freshSeed
      ? [
          '',
          '## NUEVA DIRECCION CREATIVA (sustituye a la Seed del encargo original)',
          renderSeedBlock(freshSeed.randomString),
        ]
      : []),
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
    promptId: landing.promptId ?? (await ensurePrompt(ctx, project, undefined, landing.technologyIds)).id,
    content: variationPrompt,
    systemInstruction,
    sections: sourceVersion?.sections ?? [],
    technologyIds: landing.technologyIds,
    seedStringValue,
    negativeConstraints: sourceVersion?.negativeConstraints ?? project.negativeConstraints,
    conflicts: sourceVersion?.conflicts ?? [],
    providerId: input.providerId ?? null,
    model: input.model ?? null,
    config: null,
    changeNote: `Variante: ${strategy.label}`,
  });

  return runGeneration(ctx, {
    project,
    promptId: promptVersion.promptId,
    promptVersionId: promptVersion.id,
    system: systemInstruction,
    prompt: variationPrompt,
    providerId: input.providerId,
    model: input.model,
    kind: 'variation',
    label: strategy.label,
    allowCache: false,
    technologyIds: landing.technologyIds,
    seedStringValue,
    // Una variante es una Landing Page nueva, no una version de la anterior.
    existingLandingId: null,
    nameSuffix: strategy.label,
    // Si se genero una Seed nueva, esa llamada ya paso segundos antes por el
    // enfriamiento: esta la seguiria bloqueando casi siempre.
    skipCooldown: !!freshSeed,
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
  /** Ver `skipCooldown` en `OrchestratorRequest`: para cuando esta llamada sigue, en la misma operacion, a otra ya limitada (p.ej. la Seed que se acaba de generar). */
  skipCooldown?: boolean;
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
      skipCooldown: input.skipCooldown,
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
  technologyIds: string[],
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
    technologyIds,
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
