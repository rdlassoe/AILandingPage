import { composeTechnologies } from './composer';
import { getTechniques } from './design-techniques';
import { renderSeedBlock, resolveSeed } from './seed-engine';
import { estimateTokens } from '@/lib/utils';
import type { DefineSpec, Project, PromptSection, PromptSectionId, SectionSpec } from '@/types/domain';
import type { BuiltPrompt, PromptBuildInput } from '@/types/services';

export * from './design-techniques';
export * from './seed-engine';
export * from './composer';
export * from './template';

/**
 * Prompt Engine
 *
 * Ensambla un prompt estructurado en 17 secciones canonicas a partir del
 * proyecto, el stack tecnologico, la Seed String, las tecnicas de diseno y
 * las restricciones negativas. El resultado es determinista: el mismo
 * proyecto produce siempre el mismo prompt, lo que hace posible versionarlo
 * y cachear la generacion.
 */

const SECTION_TITLES: Record<PromptSectionId, string> = {
  ROLE: 'ROLE',
  CONTEXT: 'CONTEXT',
  OBJECTIVE: 'OBJECTIVE',
  TARGET_AUDIENCE: 'TARGET AUDIENCE',
  BUSINESS_GOAL: 'BUSINESS GOAL',
  VISUAL_DIRECTION: 'VISUAL DIRECTION',
  SEED_STRING: 'SEED STRING',
  INFORMATION_ARCHITECTURE: 'INFORMATION ARCHITECTURE',
  COPY_REQUIREMENTS: 'COPY REQUIREMENTS',
  TECHNOLOGY: 'TECHNOLOGY',
  FUNCTIONAL_REQUIREMENTS: 'FUNCTIONAL REQUIREMENTS',
  RESPONSIVE_REQUIREMENTS: 'RESPONSIVE REQUIREMENTS',
  ACCESSIBILITY: 'ACCESSIBILITY',
  SUBTRACTIVE_DESIGN: 'SUBTRACTIVE DESIGN',
  NEGATIVE_CONSTRAINTS: 'NEGATIVE CONSTRAINTS',
  QUALITY_CRITERIA: 'QUALITY CRITERIA',
  OUTPUT_FORMAT: 'OUTPUT FORMAT',
};

const SECTION_ORDER: PromptSectionId[] = [
  'ROLE',
  'CONTEXT',
  'OBJECTIVE',
  'TARGET_AUDIENCE',
  'BUSINESS_GOAL',
  'VISUAL_DIRECTION',
  'SEED_STRING',
  'INFORMATION_ARCHITECTURE',
  'COPY_REQUIREMENTS',
  'TECHNOLOGY',
  'FUNCTIONAL_REQUIREMENTS',
  'RESPONSIVE_REQUIREMENTS',
  'ACCESSIBILITY',
  'SUBTRACTIVE_DESIGN',
  'NEGATIVE_CONSTRAINTS',
  'QUALITY_CRITERIA',
  'OUTPUT_FORMAT',
];

/** Instruccion de sistema por defecto si no hay plantilla en base de datos. */
export const DEFAULT_SYSTEM_INSTRUCTION = [
  'Eres un equipo compuesto por un director de arte digital, un disenador de producto senior,',
  'un copywriter de conversion y un desarrollador front-end. Trabajas para clientes exigentes',
  'que rechazan resultados genericos.',
  '',
  'Reglas invariables:',
  '1. Devuelves UNICAMENTE codigo. Nunca escribes introducciones, explicaciones ni despedidas.',
  '2. La primera linea de tu respuesta es exactamente "<!DOCTYPE html>".',
  '3. La ultima linea de tu respuesta es exactamente "</html>".',
  '4. No envuelves la respuesta en bloques de markdown.',
  '5. Todo el contenido textual es real y especifico del proyecto: nunca lorem ipsum.',
  '6. Cada interaccion que anuncias debe estar implementada y funcionar.',
  '7. Cumples las restricciones negativas como requisitos duros, no como sugerencias.',
].join('\n');

const DEFAULT_SECTIONS: SectionSpec[] = [
  { id: 'hero', name: 'Hero', purpose: 'Decir que es, para quien y que hacer a continuacion', order: 1, contentNotes: '', required: true },
  { id: 'value', name: 'Propuesta de valor', purpose: 'Explicar el problema y como se resuelve', order: 2, contentNotes: '', required: true },
  { id: 'features', name: 'Caracteristicas', purpose: 'Mostrar lo que hace, sin adornos', order: 3, contentNotes: '', required: true },
  { id: 'how', name: 'Como funciona', purpose: 'Reducir la incertidumbre del primer uso', order: 4, contentNotes: '', required: false },
  { id: 'benefits', name: 'Beneficios', purpose: 'Traducir caracteristicas a consecuencias', order: 5, contentNotes: '', required: false },
  { id: 'faq', name: 'Preguntas frecuentes', purpose: 'Resolver las objeciones que frenan la conversion', order: 6, contentNotes: '', required: false },
  { id: 'cta', name: 'CTA final', purpose: 'Cerrar con una unica accion clara', order: 7, contentNotes: '', required: true },
];

export function buildLandingPrompt(input: PromptBuildInput): BuiltPrompt {
  const { project } = input;
  const seed = resolveSeed(input.seed, input.customSeedValue);
  const technology = composeTechnologies(input.technologies);
  const techniques = getTechniques(input.designTechniques);
  const architecture = resolveArchitecture(project, input.define ?? project.define);
  const negativeConstraints = input.negativeConstraints.filter((item) => item.trim().length > 0);
  const discover = input.discover ?? project.discover;

  const sections: PromptSection[] = [];
  const add = (id: PromptSectionId, body: string) => {
    const trimmed = body.trim();
    if (trimmed.length > 0) sections.push({ id, title: SECTION_TITLES[id], body: trimmed });
  };

  add(
    'ROLE',
    [
      'Actuas como director de arte digital, disenador de producto, copywriter de conversion',
      'y desarrollador front-end al mismo tiempo. Entregas una Landing Page terminada,',
      'no un boceto ni una explicacion.',
    ].join('\n'),
  );

  add(
    'CONTEXT',
    [
      `- Proyecto: ${project.basics.name}`,
      `- Tema: ${project.basics.theme}`,
      `- Producto o servicio: ${project.basics.productOrService}`,
      `- Tipo de landing: ${project.basics.landingType}`,
      `- Descripcion: ${project.basics.description}`,
      ...(discover
        ? [
            '',
            '### Analisis previo (fase DISCOVER)',
            `- Nicho: ${discover.niche}`,
            `- Propuesta de valor: ${discover.valueProposition}`,
            `- Contexto de mercado: ${discover.context}`,
            `- Sofisticacion del mercado (1-5): ${discover.marketSophistication}`,
            ...(discover.differentiators.length > 0
              ? ['- Diferenciadores:', ...discover.differentiators.map((item) => `  - ${item}`)]
              : []),
            ...(discover.frictions.length > 0
              ? ['- Fricciones a resolver en la pagina:', ...discover.frictions.map((item) => `  - ${item}`)]
              : []),
          ]
        : []),
    ].join('\n'),
  );

  add(
    'OBJECTIVE',
    [
      `- Objetivo: ${project.basics.primaryGoal}`,
      '',
      'La pagina debe conseguir que un visitante que no conoce el producto entienda,',
      'en menos de quince segundos, que es, para quien es y que gana si actua.',
    ].join('\n'),
  );

  add(
    'TARGET_AUDIENCE',
    [
      `- Publico: ${project.basics.targetAudience}`,
      ...(discover?.audienceInsight ? ['', `Insight: ${discover.audienceInsight}`] : []),
      '',
      'Escribe para ese publico concreto: usa su vocabulario y habla de sus problemas reales,',
      'no de los beneficios que le gustaria contar a la empresa.',
    ].join('\n'),
  );

  add(
    'BUSINESS_GOAL',
    [
      `- Objetivo de negocio: ${project.basics.primaryGoal}`,
      `- CTA principal: ${project.basics.primaryCta}`,
      '',
      'Todo lo que no acerque al visitante a ese CTA compite con el.',
    ].join('\n'),
  );

  add(
    'VISUAL_DIRECTION',
    [
      `- Estilo: ${project.visual.style}`,
      `- Colores: ${project.visual.colors.length > 0 ? project.visual.colors.join(', ') : 'a decidir de forma coherente con la Seed String'}`,
      `- Tipografia: ${project.visual.typography}`,
      `- Nivel de sofisticacion (1-5): ${project.visual.sophistication}`,
      ...(project.visual.references.length > 0
        ? ['- Referencias:', ...project.visual.references.map((item) => `  - ${item}`)]
        : []),
      ...(project.visual.avoid.length > 0
        ? ['- Evitar explicitamente:', ...project.visual.avoid.map((item) => `  - ${item}`)]
        : []),
    ].join('\n'),
  );

  add('SEED_STRING', renderSeedBlock(seed));

  add(
    'INFORMATION_ARCHITECTURE',
    [
      'Construye la pagina exactamente con estas secciones, en este orden:',
      '',
      ...architecture.map(
        (section, index) =>
          `${index + 1}. ${section.name} — ${section.purpose}${section.contentNotes ? `. ${section.contentNotes}` : ''}`,
      ),
      '',
      'No anadas secciones que no esten en esta lista.',
    ].join('\n'),
  );

  add(
    'COPY_REQUIREMENTS',
    [
      `- Tono: ${project.content.tone}`,
      `- Mensaje principal: ${project.content.keyMessage || project.basics.description}`,
      `- Caracteristicas: ${project.content.features.length > 0 ? project.content.features.join(', ') : 'derivalas del producto descrito'}`,
      `- Beneficios: ${project.content.benefits.length > 0 ? project.content.benefits.join(', ') : 'traduce cada caracteristica a una consecuencia concreta'}`,
      '',
      'Todo el texto es definitivo: nombres, cifras y ejemplos coherentes con el proyecto.',
      'Ningun marcador de posicion.',
    ].join('\n'),
  );

  add('TECHNOLOGY', technology.block);

  add(
    'FUNCTIONAL_REQUIREMENTS',
    [
      '- La navegacion movil abre y cierra de verdad.',
      '- Las preguntas frecuentes se despliegan con control por teclado.',
      '- El formulario valida en cliente y muestra un mensaje de exito o de error explicito.',
      '- Los enlaces internos apuntan a anclas que existen en el documento.',
      '- No hay errores en la consola del navegador.',
      '- Ninguna funcionalidad anunciada queda sin implementar.',
      ...(project.technical.constraints.length > 0
        ? ['', 'Restricciones tecnicas del proyecto:', ...project.technical.constraints.map((item) => `- ${item}`)]
        : []),
    ].join('\n'),
  );

  add(
    'RESPONSIVE_REQUIREMENTS',
    [
      '- Trabaja mobile-first: los estilos base son los de movil.',
      '- Puntos de ruptura minimos en 768px y 1024px.',
      '- A 360px de ancho no hay desbordamiento horizontal ni texto cortado.',
      '- Las areas tactiles miden al menos 44x44 px.',
      '- Las retículas de 3 columnas pasan a 1 columna en movil, no a scroll lateral.',
    ].join('\n'),
  );

  add(
    'ACCESSIBILITY',
    [
      '- Cumple WCAG 2.1 nivel AA.',
      '- Contraste minimo 4.5:1 en texto normal y 3:1 en texto grande.',
      '- Un unico <h1>; jerarquia de encabezados sin saltos.',
      '- Todo control interactivo es alcanzable y operable con teclado.',
      '- :focus-visible con indicador de al menos 2px y offset.',
      '- Cada campo de formulario tiene <label> asociado; el placeholder no lo sustituye.',
      '- Los estados dinamicos actualizan aria-expanded / aria-hidden.',
      '- Enlace "Saltar al contenido" como primer elemento enfocable.',
      '- @media (prefers-reduced-motion: reduce) desactiva las animaciones no esenciales.',
      ...(project.define?.accessibilityCriteria?.length
        ? project.define.accessibilityCriteria.map((item) => `- ${item}`)
        : []),
    ].join('\n'),
  );

  const subtractive = techniques.find((technique) => technique.id === 'subtractive-design');
  const otherTechniques = techniques.filter((technique) => technique.id !== 'subtractive-design');

  add(
    'SUBTRACTIVE_DESIGN',
    [
      ...(subtractive ? [subtractive.instruction] : []),
      ...(otherTechniques.length > 0
        ? ['', '### Otras tecnicas activas', ...otherTechniques.map((t) => `#### ${t.label}\n${t.instruction}`)]
        : []),
    ].join('\n'),
  );

  add(
    'NEGATIVE_CONSTRAINTS',
    [
      'Estas restricciones son requisitos duros. Incumplir una invalida la entrega.',
      '',
      ...negativeConstraints.map((item) => `- ${item}`),
    ].join('\n'),
  );

  add(
    'QUALITY_CRITERIA',
    [
      'Antes de responder, verifica una por una:',
      '',
      '1. Visual: jerarquia clara, composicion coherente, contraste suficiente, identidad propia.',
      '2. UX: navegacion evidente, CTA inconfundible, flujo de lectura sin saltos.',
      '3. Copy: concreto, sin cliches, con micro-copy donde hace falta, adaptado al publico.',
      '4. Codigo: HTML semantico y valido, CSS organizado por bloques, JavaScript sin errores.',
      '5. Diseno: ningun elemento sin proposito, ningun patron generico, coherencia con la Seed String.',
      '6. Restricciones: todas las restricciones negativas cumplidas.',
      '',
      'Si algun punto falla, corrigelo antes de entregar.',
    ].join('\n'),
  );

  add(
    'OUTPUT_FORMAT',
    [
      technology.selfContained
        ? 'Devuelve UN UNICO documento HTML autocontenido.'
        : 'Devuelve primero el codigo del stack solicitado y, al final, UN UNICO documento HTML autocontenido equivalente.',
      '',
      '- El CSS va embebido en <style> dentro de <head>.',
      '- El JavaScript va embebido en <script> justo antes de </body>.',
      '- Sin recursos externos salvo los que el bloque TECHNOLOGY autorice explicitamente.',
      '- Las imagenes se sustituyen por SVG inline o por bloques de color con texto alternativo real.',
      '',
      'La respuesta empieza por "<!DOCTYPE html>" y termina en "</html>".',
      'Sin texto antes. Sin texto despues. Sin bloques de markdown.',
    ].join('\n'),
  );

  const ordered = SECTION_ORDER.map((id) => sections.find((section) => section.id === id)).filter(
    (section): section is PromptSection => section !== undefined,
  );

  const content = ordered.map((section) => `## ${section.title}\n${section.body}`).join('\n\n');

  return {
    systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
    content,
    sections: ordered,
    conflicts: technology.conflicts,
    technologyIds: technology.effective.map((tech) => tech.id),
    seedStringValue: seed.source === 'none' ? null : seed.value,
    negativeConstraints,
    estimatedTokens: estimateTokens(content) + estimateTokens(DEFAULT_SYSTEM_INSTRUCTION),
  };
}

/** Arquitectura de informacion: la definida en DEFINE, la del brief, o la base. */
function resolveArchitecture(project: Project, define: DefineSpec | null | undefined): SectionSpec[] {
  if (define?.informationArchitecture && define.informationArchitecture.length > 0) {
    return [...define.informationArchitecture].sort((a, b) => a.order - b.order);
  }

  if (project.content.sections.length > 0) {
    return project.content.sections.map((name, index) => ({
      id: `section-${index + 1}`,
      name,
      purpose: purposeFor(name),
      order: index + 1,
      contentNotes: '',
      required: index === 0,
    }));
  }

  return DEFAULT_SECTIONS;
}

const PURPOSES: Array<[RegExp, string]> = [
  [/hero|portada/i, 'Decir que es, para quien y que hacer a continuacion'],
  [/valor|propuesta/i, 'Explicar el problema real y como se resuelve'],
  [/caracter|feature|funcional/i, 'Mostrar lo que hace, sin adornos'],
  [/como funciona|proceso|paso/i, 'Reducir la incertidumbre del primer uso'],
  [/beneficio|ventaja/i, 'Traducir caracteristicas en consecuencias concretas'],
  [/caso de uso|uso/i, 'Mostrar situaciones reconocibles para el publico'],
  [/prueba|social|testimon/i, 'Aportar evidencia verificable'],
  [/dato|resultado|metric/i, 'Cuantificar el impacto con cifras concretas'],
  [/comparativa/i, 'Situar la alternativa frente a lo que ya usa el publico'],
  [/precio|plan|tarifa/i, 'Hacer el coste predecible y sin sorpresas'],
  [/equipo|nosotros/i, 'Dar contexto sobre quien hay detras'],
  [/faq|pregunta|duda/i, 'Resolver las objeciones que frenan la conversion'],
  [/cta|contacto|empezar/i, 'Cerrar con una unica accion clara'],
  [/footer|pie/i, 'Ofrecer navegacion secundaria y datos legales'],
];

function purposeFor(name: string): string {
  for (const [pattern, purpose] of PURPOSES) {
    if (pattern.test(name)) return purpose;
  }
  return 'Aportar informacion que acerque al visitante a la accion principal';
}
