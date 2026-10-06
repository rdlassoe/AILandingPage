import 'server-only';

import type { DataStore } from '@/lib/data/types';
import { notFound } from '@/lib/errors';
import { clamp, newId, truncate } from '@/lib/utils';
import { runLLMJson } from '@/services/llm-orchestrator';
import { buildPromptForProject } from '@/services/landing-generator';
import type {
  CriticDimension,
  CriticIssue,
  CriticScores,
  CriticSeverity,
  CriticSuggestion,
  GenerationReview,
} from '@/types/domain';
import type { CritiqueInput } from '@/types/services';

/**
 * Critic Engine
 *
 * Segundo agente del bucle creador/critico: audita la Landing Page ya
 * generada frente a los requisitos del proyecto y devuelve problemas,
 * sugerencias priorizadas y un prompt de refinamiento listo para ejecutar.
 *
 * El Critic NUNCA modifica la pagina: solo propone. El usuario decide que
 * sugerencias se aplican antes de lanzar el refinamiento.
 */

const CRITIC_SYSTEM = [
  'Eres un auditor independiente de producto digital. No disenaste esta pagina y no tienes',
  'ningun interes en defenderla. Auditas UX, accesibilidad (WCAG 2.1 AA), jerarquia visual,',
  'comportamiento responsive, claridad del copy, estrategia de CTA, calidad del codigo y',
  'presencia de patrones genericos de IA.',
  '',
  'Eres exigente pero util: cada problema que senalas incluye una accion concreta.',
  'No senalas problemas inventados ni repites el mismo problema con distintas palabras.',
  'Devuelves UNICAMENTE un objeto JSON valido, sin markdown ni texto adicional.',
].join('\n');

/** Limite del HTML enviado al modelo para no agotar la ventana de contexto. */
const MAX_HTML_CHARS = 60_000;

/**
 * Aviso que acompana al codigo cuando hay que recortarlo.
 *
 * Sin el, el critico audita un documento incompleto y reporta como fallos
 * cosas que si estaban (un footer ausente, un CTA de cierre que falta). Es
 * peor que no auditar: son hallazgos falsos que el usuario aplicaria.
 */
const TRUNCATION_NOTICE =
  'AVISO: el documento se muestra recortado por longitud. Audita solo lo que ves ' +
  'y no supongas que falta lo que podria estar en la parte no mostrada.';

const DIMENSIONS: CriticDimension[] = [
  'ux',
  'accessibility',
  'hierarchy',
  'responsive',
  'clarity',
  'visual-consistency',
  'cta',
  'content',
  'code',
  'subtractive',
  'generic-patterns',
];

const SEVERITIES: CriticSeverity[] = ['critical', 'high', 'medium', 'low'];

interface RawCritique {
  issues?: Array<{
    dimension?: string;
    severity?: string;
    title?: string;
    description?: string;
    location?: string | null;
    id?: string;
  }>;
  suggestions?: Array<{
    dimension?: string;
    title?: string;
    action?: string;
    impact?: string;
    issueId?: string | null;
    id?: string;
  }>;
  scores?: Partial<CriticScores>;
  refinementPrompt?: string;
  priority?: string[];
}

export interface CriticContext {
  ownerId: string;
  store: DataStore;
}

export async function critiqueLanding(
  ctx: CriticContext,
  input: CritiqueInput,
): Promise<GenerationReview> {
  const landing = await ctx.store.getLandingPage(ctx.ownerId, input.landingPageId);
  if (!landing || landing.ownerId !== ctx.ownerId) throw notFound('esa Landing Page');

  const project = landing.projectId ? await ctx.store.getProject(ctx.ownerId, landing.projectId) : null;

  const requirements = project
    ? [
        `Proyecto: ${project.basics.name}`,
        `Publico: ${project.basics.targetAudience}`,
        `Objetivo: ${project.basics.primaryGoal}`,
        `CTA principal: ${project.basics.primaryCta}`,
        // El asistente ya no pregunta por el estilo: solo se pide contrastar si el proyecto lo fijo.
        project.visual.style.trim() ? `Estilo pedido: ${project.visual.style.trim()}` : '',
        `Tono: ${project.content.tone}`,
      ]
        .filter(Boolean)
        .join('\n')
    : 'No hay proyecto asociado: audita la pagina por sus propios meritos.';

  // Las restricciones que debian cumplirse son las que aplico el prompt que produjo la
  // pagina (la tecnica "Restricciones negativas" mas las del proyecto), no solo las del
  // proyecto: ya no hay una lista por defecto en el brief.
  const promptVersion = landing.promptVersionId
    ? await ctx.store.getPromptVersion(ctx.ownerId, landing.promptVersionId)
    : null;
  const appliedConstraints = promptVersion ? promptVersion.negativeConstraints : (project?.negativeConstraints ?? []);
  const constraints =
    appliedConstraints.length > 0
      ? appliedConstraints.map((item) => `- ${item}`).join('\n')
      : '- (el prompt no aplico restricciones negativas)';

  const userPrompt = [
    'REQUISITOS DEL PROYECTO',
    requirements,
    '',
    'RESTRICCIONES QUE DEBIAN CUMPLIRSE',
    constraints,
    '',
    'CODIGO A AUDITAR',
    ...(landing.html.length > MAX_HTML_CHARS ? [TRUNCATION_NOTICE] : []),
    truncate(landing.html, MAX_HTML_CHARS),
    '',
    'Devuelve este JSON exacto:',
    '{',
    '  "issues": [{ "dimension": "...", "severity": "critical|high|medium|low", "title": "...", "description": "...", "location": "..." }],',
    '  "suggestions": [{ "dimension": "...", "title": "...", "action": "...", "impact": "alto|medio|bajo" }],',
    '  "scores": { "overall": 0, "ux": 0, "accessibility": 0, "content": 0, "code": 0, "design": 0 },',
    '  "refinementPrompt": "instrucciones listas para regenerar la pagina corrigiendo lo anterior"',
    '}',
    '',
    'Las puntuaciones van de 0 a 100. Devuelve entre 3 y 12 issues.',
  ].join('\n');

  const generation = await ctx.store.createGeneration(ctx.ownerId, {
    projectId: landing.projectId,
    promptId: landing.promptId,
    promptVersionId: landing.promptVersionId,
    kind: 'critique',
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
    landingPageId: landing.id,
    config: null,
    cacheKey: null,
    servedFromCache: false,
  });

  try {
    const { data, outcome } = await runLLMJson<RawCritique>({
      ownerId: ctx.ownerId,
      system: CRITIC_SYSTEM,
      prompt: userPrompt,
      providerId: input.providerId,
      model: input.model,
      config: { temperature: 0.3 },
    });

    const normalized = normalizeCritique(data);

    await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
      status: 'success',
      providerId: outcome.providerId,
      model: outcome.model,
      isMock: outcome.isMock,
      latencyMs: outcome.latencyMs,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      cacheKey: outcome.cacheKey,
    });

    const review = await ctx.store.createReview(ctx.ownerId, {
      generationId: generation.id,
      landingPageId: landing.id,
      issues: normalized.issues,
      suggestions: normalized.suggestions,
      priority: normalized.priority,
      scores: normalized.scores,
      refinementPrompt: normalized.refinementPrompt,
      providerId: outcome.providerId,
      model: outcome.model,
      isMock: outcome.isMock,
    });

    await ctx.store.updateLandingPage(ctx.ownerId, landing.id, {
      metadata: { ...landing.metadata, criticScore: normalized.scores.overall },
    });

    return review;
  } catch (error) {
    await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
      status: 'error',
      errorCode: 'critique_failed',
      errorMessage: error instanceof Error ? error.message : 'Error desconocido',
    });
    throw error;
  }
}

/** Construye el prompt de refinamiento completo a partir de una revision. */
export async function buildRefinementPreview(
  ctx: CriticContext,
  reviewId: string,
  acceptedSuggestionIds: string[],
): Promise<string> {
  const review = await ctx.store.getReview(ctx.ownerId, reviewId);
  if (!review) throw notFound('esa revision');

  const landing = await ctx.store.getLandingPage(ctx.ownerId, review.landingPageId);
  if (!landing) throw notFound('la Landing Page asociada');

  const project = landing.projectId ? await ctx.store.getProject(ctx.ownerId, landing.projectId) : null;
  const built = project ? await buildPromptForProject(ctx, project) : null;

  const accepted = new Set(acceptedSuggestionIds);
  const changes = review.suggestions
    .filter((suggestion) => accepted.has(suggestion.id))
    .map((suggestion, index) => `${index + 1}. ${suggestion.title}: ${suggestion.action}`);

  return [
    'Vas a corregir una Landing Page existente.',
    '',
    '## CAMBIOS QUE DEBES APLICAR',
    changes.length > 0 ? changes.join('\n') : '(selecciona recomendaciones para verlas aqui)',
    '',
    '## ENCARGO ORIGINAL',
    built ? truncate(built.content, 4_000) : '(no disponible)',
  ].join('\n');
}

/* -------------------------------------------------------------------------
 * Normalizacion
 * ---------------------------------------------------------------------- */

interface NormalizedCritique {
  issues: CriticIssue[];
  suggestions: CriticSuggestion[];
  priority: string[];
  scores: CriticScores;
  refinementPrompt: string;
}

/**
 * La salida del modelo nunca se usa tal cual: se acotan dimensiones,
 * severidades y puntuaciones, y se asignan identificadores estables.
 */
function normalizeCritique(raw: RawCritique): NormalizedCritique {
  const issues: CriticIssue[] = (raw.issues ?? []).slice(0, 15).map((issue, index) => ({
    id: typeof issue.id === 'string' && issue.id.length > 0 ? issue.id : `issue-${index + 1}`,
    dimension: pickDimension(issue.dimension),
    severity: pickSeverity(issue.severity),
    title: truncate((issue.title ?? 'Problema detectado').trim(), 120),
    description: truncate((issue.description ?? '').trim(), 600),
    location: typeof issue.location === 'string' && issue.location.trim() ? issue.location.trim() : null,
  }));

  const issueIds = new Set(issues.map((issue) => issue.id));

  const suggestions: CriticSuggestion[] = (raw.suggestions ?? []).slice(0, 15).map((suggestion, index) => {
    const linked = typeof suggestion.issueId === 'string' && issueIds.has(suggestion.issueId)
      ? suggestion.issueId
      : issues[index]?.id ?? null;

    return {
      id: typeof suggestion.id === 'string' && suggestion.id.length > 0 ? suggestion.id : `suggestion-${index + 1}`,
      issueId: linked,
      dimension: pickDimension(suggestion.dimension),
      title: truncate((suggestion.title ?? 'Mejora propuesta').trim(), 120),
      action: truncate((suggestion.action ?? '').trim(), 600),
      impact: pickImpact(suggestion.impact),
    };
  });

  const scores: CriticScores = {
    overall: score(raw.scores?.overall),
    ux: score(raw.scores?.ux),
    accessibility: score(raw.scores?.accessibility),
    content: score(raw.scores?.content),
    code: score(raw.scores?.code),
    design: score(raw.scores?.design),
  };

  if (!raw.scores?.overall) {
    scores.overall = Math.round((scores.ux + scores.accessibility + scores.content + scores.code + scores.design) / 5);
  }

  const priority =
    Array.isArray(raw.priority) && raw.priority.length > 0
      ? raw.priority.filter((id) => issueIds.has(id))
      : [...issues]
          .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
          .map((issue) => issue.id);

  const refinementPrompt =
    typeof raw.refinementPrompt === 'string' && raw.refinementPrompt.trim().length > 20
      ? raw.refinementPrompt.trim()
      : buildFallbackRefinementPrompt(suggestions);

  // Si el modelo no aporto ninguna sugerencia, se deriva una por cada issue.
  if (suggestions.length === 0 && issues.length > 0) {
    for (const issue of issues) {
      suggestions.push({
        id: newId(),
        issueId: issue.id,
        dimension: issue.dimension,
        title: issue.title,
        action: issue.description || 'Corrige el problema descrito.',
        impact: issue.severity === 'critical' || issue.severity === 'high' ? 'alto' : 'medio',
      });
    }
  }

  return { issues, suggestions, priority, scores, refinementPrompt };
}

function pickDimension(value: string | undefined): CriticDimension {
  const normalized = (value ?? '').trim().toLowerCase() as CriticDimension;
  return DIMENSIONS.includes(normalized) ? normalized : 'ux';
}

function pickSeverity(value: string | undefined): CriticSeverity {
  const normalized = (value ?? '').trim().toLowerCase() as CriticSeverity;
  return SEVERITIES.includes(normalized) ? normalized : 'medium';
}

function pickImpact(value: string | undefined): CriticSuggestion['impact'] {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'alto' || normalized === 'high') return 'alto';
  if (normalized === 'bajo' || normalized === 'low') return 'bajo';
  return 'medio';
}

function score(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 60;
  return Math.round(clamp(value, 0, 100));
}

function buildFallbackRefinementPrompt(suggestions: CriticSuggestion[]): string {
  if (suggestions.length === 0) {
    return 'No se detectaron cambios obligatorios. Revisa el copy a mano antes de publicar.';
  }
  return [
    'Corrige la Landing Page aplicando exactamente estos cambios y nada mas:',
    '',
    ...suggestions.map((suggestion, index) => `${index + 1}. ${suggestion.title}: ${suggestion.action}`),
    '',
    'Manten el resto del contenido, el tono y la identidad visual intactos.',
  ].join('\n');
}
