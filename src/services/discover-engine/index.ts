import 'server-only';

import type { DataStore } from '@/lib/data/types';
import { notFound } from '@/lib/errors';
import { clamp, nowIso, truncate } from '@/lib/utils';
import { runLLMJson } from '@/services/llm-orchestrator';
import type { DefineSpec, DiscoverInsights, Project, SectionSpec } from '@/types/domain';
import type { ProviderId } from '@/types/llm';

/**
 * DISCOVER -> DEFINE
 *
 * DISCOVER analiza el encargo (nicho, publico, propuesta de valor, fricciones)
 * y guarda el resultado en el proyecto. DEFINE convierte ese analisis en una
 * arquitectura de informacion y unos criterios concretos, sin volver a llamar
 * al modelo: es una transformacion determinista que el usuario puede editar.
 *
 * La fase DELIVER es responsabilidad del Landing Generator.
 */

const DISCOVER_SYSTEM = [
  'Eres un estratega de producto digital. Analizas el encargo antes de disenar nada.',
  'Devuelves UNICAMENTE un objeto JSON valido, sin markdown ni texto adicional.',
  'Tu analisis es concreto: nada de generalidades aplicables a cualquier negocio.',
].join('\n');

interface RawDiscover {
  niche?: string;
  audienceInsight?: string;
  valueProposition?: string;
  context?: string;
  differentiators?: unknown;
  visualDirections?: unknown;
  marketSophistication?: unknown;
  frictions?: unknown;
}

export interface DiscoverContext {
  ownerId: string;
  store: DataStore;
}

export async function runDiscover(
  ctx: DiscoverContext,
  projectId: string,
  options: { providerId?: ProviderId; model?: string } = {},
): Promise<DiscoverInsights> {
  const project = await ctx.store.getProject(ctx.ownerId, projectId);
  if (!project) throw notFound('ese proyecto');

  const brief = buildBrief(project);

  const generation = await ctx.store.createGeneration(ctx.ownerId, {
    projectId: project.id,
    promptId: null,
    promptVersionId: null,
    kind: 'discover',
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
    const { data, outcome } = await runLLMJson<RawDiscover>({
      ownerId: ctx.ownerId,
      system: DISCOVER_SYSTEM,
      prompt: [
        'Analiza este encargo de Landing Page:',
        '',
        brief,
        '',
        'Devuelve este JSON exacto:',
        '{',
        '  "niche": "nicho concreto en una frase",',
        '  "audienceInsight": "que le preocupa realmente a este publico, en 2-3 frases",',
        '  "valueProposition": "propuesta de valor en una frase, sin adjetivos vacios",',
        '  "context": "contexto de mercado y momento de compra",',
        '  "differentiators": ["3-5 diferenciadores concretos"],',
        '  "visualDirections": ["3 direcciones visuales posibles"],',
        '  "marketSophistication": 3,',
        '  "frictions": ["3-5 objeciones reales que frenan la conversion"]',
        '}',
        '',
        'marketSophistication va de 1 (mercado virgen) a 5 (mercado saturado de publicidad).',
      ].join('\n'),
      providerId: options.providerId,
      model: options.model,
      config: { temperature: 0.6 },
    });

    const insights = normalizeDiscover(data);

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

    await ctx.store.updateProject(ctx.ownerId, project.id, { discover: insights });

    return insights;
  } catch (error) {
    await ctx.store.updateGeneration(ctx.ownerId, generation.id, {
      status: 'error',
      errorCode: 'discover_failed',
      errorMessage: error instanceof Error ? error.message : 'Error desconocido',
    });
    throw error;
  }
}

/**
 * DEFINE: transformacion determinista del brief + DISCOVER en una
 * especificacion editable. No consume cuota de ningun proveedor.
 */
export function buildDefineSpec(project: Project): DefineSpec {
  const sectionNames =
    project.content.sections.length > 0
      ? project.content.sections
      : ['Hero', 'Propuesta de valor', 'Caracteristicas', 'Como funciona', 'Preguntas frecuentes', 'CTA final'];

  const informationArchitecture: SectionSpec[] = sectionNames.map((name, index) => ({
    id: `section-${index + 1}`,
    name,
    purpose: purposeFor(name, project),
    order: index + 1,
    contentNotes: notesFor(name, project),
    required: index === 0 || /cta/i.test(name),
  }));

  const sophistication = project.discover?.marketSophistication ?? project.visual.sophistication;

  return {
    informationArchitecture,
    visualHierarchy: [
      `Un unico elemento dominante por pantalla, empezando por "${project.content.keyMessage || project.basics.description}".`,
      'Jerarquia construida con tamano y espacio antes que con color.',
    ].join(' '),
    ctaStrategy: [
      `CTA principal: "${project.basics.primaryCta}".`,
      'Aparece en el hero y se repite al cierre; el resto de acciones son secundarias y visualmente subordinadas.',
    ].join(' '),
    copyStrategy:
      sophistication >= 4
        ? 'Mercado saturado: entra por el mecanismo concreto y por la prueba, no por la promesa.'
        : 'Mercado poco saturado: explica primero el problema y el resultado, luego el mecanismo.',
    styleDirection: project.seedStringValue
      ? `Direccion creativa anclada en: ${project.seedStringValue}`
      : project.visual.style,
    accessibilityCriteria: [
      'Contraste minimo 4.5:1 en texto de cuerpo.',
      'Navegacion completa por teclado con foco visible.',
      'Un unico h1 y jerarquia de encabezados sin saltos.',
      'Formularios con label asociado y mensajes de error accesibles.',
    ],
    responsiveCriteria: [
      'Mobile-first con breakpoints en 768px y 1024px.',
      'Sin desbordamiento horizontal a 360px.',
      'Areas tactiles de al menos 44x44 px.',
    ],
    definedAt: nowIso(),
  };
}

function buildBrief(project: Project): string {
  return [
    `Proyecto: ${project.basics.name}`,
    `Tema: ${project.basics.theme}`,
    `Producto o servicio: ${project.basics.productOrService}`,
    `Tipo de landing: ${project.basics.landingType}`,
    `Descripcion: ${project.basics.description}`,
    `Publico objetivo: ${project.basics.targetAudience}`,
    `Objetivo principal: ${project.basics.primaryGoal}`,
    `CTA principal: ${project.basics.primaryCta}`,
    `Estilo visual: ${project.visual.style}`,
    `Tono: ${project.content.tone}`,
    project.content.features.length > 0 ? `Caracteristicas: ${project.content.features.join(', ')}` : '',
    project.content.benefits.length > 0 ? `Beneficios: ${project.content.benefits.join(', ')}` : '',
    project.seedStringValue ? `Seed String: ${project.seedStringValue}` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function normalizeDiscover(raw: RawDiscover): DiscoverInsights {
  return {
    niche: truncate(text(raw.niche, 'Nicho no determinado'), 240),
    audienceInsight: truncate(text(raw.audienceInsight, ''), 800),
    valueProposition: truncate(text(raw.valueProposition, ''), 400),
    context: truncate(text(raw.context, ''), 800),
    differentiators: stringList(raw.differentiators, 6),
    visualDirections: stringList(raw.visualDirections, 4),
    marketSophistication: Math.round(
      clamp(typeof raw.marketSophistication === 'number' ? raw.marketSophistication : 3, 1, 5),
    ),
    frictions: stringList(raw.frictions, 6),
    generatedAt: nowIso(),
  };
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => truncate(item.trim(), 200))
    .filter((item) => item.length > 0)
    .slice(0, max);
}

const PURPOSES: Array<[RegExp, string]> = [
  [/hero|portada/i, 'Decir que es, para quien y que hacer a continuacion'],
  [/valor|propuesta/i, 'Explicar el problema real y como se resuelve'],
  [/caracter|feature/i, 'Mostrar lo que hace, sin adornos'],
  [/como funciona|proceso|paso/i, 'Reducir la incertidumbre del primer uso'],
  [/beneficio|ventaja/i, 'Traducir caracteristicas en consecuencias concretas'],
  [/prueba|social|testimon/i, 'Aportar evidencia verificable'],
  [/dato|resultado|metric/i, 'Cuantificar el impacto con cifras'],
  [/precio|plan|tarifa/i, 'Hacer el coste predecible'],
  [/faq|pregunta|duda/i, 'Resolver las objeciones que frenan la conversion'],
  [/cta|contacto|empezar/i, 'Cerrar con una unica accion clara'],
  [/footer|pie/i, 'Navegacion secundaria y datos legales'],
];

function purposeFor(name: string, project: Project): string {
  for (const [pattern, purpose] of PURPOSES) {
    if (pattern.test(name)) return purpose;
  }
  return `Acercar a ${project.basics.targetAudience} a la accion principal`;
}

function notesFor(name: string, project: Project): string {
  if (/hero/i.test(name)) {
    return `Titular con el mensaje principal y CTA "${project.basics.primaryCta}".`;
  }
  if (/caracter|feature/i.test(name) && project.content.features.length > 0) {
    return `Cubrir: ${project.content.features.slice(0, 5).join(', ')}.`;
  }
  if (/beneficio/i.test(name) && project.content.benefits.length > 0) {
    return `Cubrir: ${project.content.benefits.slice(0, 5).join(', ')}.`;
  }
  if (/faq|pregunta/i.test(name) && project.discover?.frictions.length) {
    return `Responder a: ${project.discover.frictions.slice(0, 4).join('; ')}.`;
  }
  return '';
}
