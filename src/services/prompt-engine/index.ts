import { composeTechnologies } from './composer';
import { BASE_NEGATIVE_CONSTRAINTS, getTechniques } from './design-techniques';
import { SECTION_ORDER, SECTION_TITLES, buildSystemInstruction } from './sections';
import { renderSeedBlock } from './seed-engine';
import { estimateTokens } from '@/lib/utils';
import type {
  DefineSpec,
  DiscoverInsights,
  Project,
  PromptSection,
  PromptSectionId,
  SectionSpec,
} from '@/types/domain';
import type { BuiltPrompt, DesignTechniqueId, PromptBuildInput } from '@/types/services';

export * from './design-techniques';
export * from './seed-engine';
export * from './composer';
export * from './template';
export * from './llm-prompt-composer';
export * from './composed-prompt';
export * from './sections';

/**
 * Prompt Engine
 *
 * Ensambla un prompt estructurado en hasta 17 secciones canonicas a partir
 * del proyecto, el stack tecnologico, la Seed String, las tecnicas de diseno y
 * las restricciones negativas. El resultado es determinista: el mismo
 * proyecto (y la misma Seed) produce siempre el mismo prompt, lo que hace
 * posible versionarlo y cachear la generacion.
 *
 * Las tecnicas de diseno son lo UNICO opcional del prompt, y solo aparecen
 * las que el usuario eligio: SEED STRING existe si y solo si esta elegida
 * "Cadenas Semilla" (`seed-strings`), NEGATIVE CONSTRAINTS si y solo si esta
 * elegida "Restricciones negativas" (`negative-constraints-plus`), y SUBTRACTIVE
 * DESIGN —el contenedor del texto del resto de tecnicas— solo si hay alguna
 * elegida. Por eso el prompt puede tener menos de 17 secciones.
 *
 * El texto base (todo lo que no sale de una tecnica) es neutro: no lleva
 * versiones parciales de ninguna. Una auditoria de elementos, un bucle de
 * autorrevision, reglas de redaccion o restricciones negativas solo existen
 * porque la tecnica correspondiente esta elegida.
 *
 * El brief ya no fija estilo, secciones, caracteristicas ni restricciones
 * (el asistente tiene 3 pasos). Cuando faltan, el borrador lo dice con una
 * frase que delega la decision —"es decision tuya", "define tu la
 * estructura"— y el compositor LLM escribe ahi contenido concreto.
 */

export function buildLandingPrompt(input: PromptBuildInput): BuiltPrompt {
  const { project } = input;
  const technology = composeTechnologies(input.technologies);
  const techniques = getTechniques(input.designTechniques);
  const chosen = (id: DesignTechniqueId) => techniques.some((technique) => technique.id === id);
  // La Seed es la tecnica "Cadenas Semilla": sin elegirla no hay seccion, ni
  // referencias a ella en el resto del borrador (direccion visual y criterios).
  const randomSeedString = chosen('seed-strings') ? input.randomSeedString?.trim() || null : null;
  // Con "Generacion de imagenes" elegida, OUTPUT_FORMAT deja de decir que las
  // imagenes son SVG inline: el sistema rellena los marcadores `data-ai-image`.
  const imagesRequested = chosen('image-generation');
  // Las restricciones negativas son la tecnica "Restricciones negativas": sin
  // elegirla no hay lista, ni seccion, ni regla en el sistema que las mencione.
  // Con ella, la lista base de la tecnica mas las que el proyecto declare.
  const negativeApplied = chosen('negative-constraints-plus');
  const negativeConstraints = negativeApplied ? mergeConstraints(BASE_NEGATIVE_CONSTRAINTS, input.negativeConstraints) : [];
  const architecture = resolveArchitecture(project, input.define ?? project.define);
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
    ].join('\n'),
  );

  add(
    'BUSINESS_GOAL',
    [
      `- Objetivo de negocio: ${project.basics.primaryGoal}`,
      `- CTA principal: ${project.basics.primaryCta}`,
    ].join('\n'),
  );

  add('VISUAL_DIRECTION', renderVisualDirection(project, discover, randomSeedString));

  if (randomSeedString) add('SEED_STRING', renderSeedBlock(randomSeedString));

  add(
    'INFORMATION_ARCHITECTURE',
    architecture
      ? [
          'Construye la pagina exactamente con estas secciones, en este orden:',
          '',
          ...architecture.map(
            (section, index) =>
              `${index + 1}. ${section.name} — ${section.purpose}${section.contentNotes ? `. ${section.contentNotes}` : ''}`,
          ),
          '',
          'No anadas secciones que no esten en esta lista.',
        ].join('\n')
      : // Sin vinetas ni numeracion a proposito: el Mock Provider lee como seccion cada linea numerada.
        [
          `El encargo no fija las secciones: define tu la estructura mas adecuada para este tipo de landing (${project.basics.landingType}) y su publico.`,
          'Empieza por un Hero que presente la propuesta y el CTA principal.',
        ].join('\n'),
  );

  add('COPY_REQUIREMENTS', renderCopyRequirements(project));

  add('TECHNOLOGY', technology.block);

  // Las interacciones son condicionales: la arquitectura puede no traer FAQ ni
  // formulario, y exigirlos contradice "no anadas secciones que no esten".
  add(
    'FUNCTIONAL_REQUIREMENTS',
    [
      '- La navegacion movil abre y cierra de verdad.',
      '- Si la pagina incluye preguntas frecuentes, se despliegan con control por teclado.',
      '- Si incluye un formulario, valida en cliente y muestra un mensaje de exito o de error explicito.',
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
      '- Las reticulas de varias columnas pasan a 1 columna en movil, no a scroll lateral.',
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

  if (negativeApplied) {
    add(
      'NEGATIVE_CONSTRAINTS',
      [
        'Estas restricciones son requisitos duros. Incumplir una invalida la entrega.',
        '',
        ...negativeConstraints.map((item) => `- ${item}`),
      ].join('\n'),
    );
  }

  // Lista declarativa: sin "verifica antes de responder" ni "corrigelo" (eso es
  // "Bucles con subagentes") y sin "ningun elemento sin proposito" (eso es
  // "Diseno sustractivo"). Cada criterio de tecnica entra solo con su tecnica.
  const criteria = [
    'Visual: jerarquia clara, composicion coherente y contraste suficiente.',
    'UX: navegacion evidente, CTA inconfundible, flujo de lectura sin saltos.',
    'Copy: adaptado al publico y al tono del proyecto.',
    'Codigo: HTML semantico y valido, CSS organizado por bloques, JavaScript sin errores.',
    ...(randomSeedString ? ['Direccion creativa: coherencia con la Seed String.'] : []),
    ...(negativeApplied ? ['Restricciones: todas las restricciones negativas cumplidas.'] : []),
  ];

  add(
    'QUALITY_CRITERIA',
    ['Criterios que debe cumplir la entrega:', '', ...criteria.map((item, index) => `${index + 1}. ${item}`)].join('\n'),
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
      imagesRequested
        ? '- Las imagenes de contenido se piden con marcadores <img data-ai-image="..."> sin src (ver la tecnica activa); el resto de elementos graficos son SVG inline o bloques de color con texto alternativo real.'
        : '- Las imagenes se sustituyen por SVG inline o por bloques de color con texto alternativo real.',
      '',
      'La respuesta empieza por "<!DOCTYPE html>" y termina en "</html>".',
      'Sin texto antes. Sin texto despues. Sin bloques de markdown.',
    ].join('\n'),
  );

  const ordered = SECTION_ORDER.map((id) => sections.find((section) => section.id === id)).filter(
    (section): section is PromptSection => section !== undefined,
  );

  const content = ordered.map((section) => `## ${section.title}\n${section.body}`).join('\n\n');

  const systemInstruction = buildSystemInstruction({ negativeConstraints: negativeApplied });

  return {
    systemInstruction,
    content,
    sections: ordered,
    conflicts: technology.conflicts,
    technologyIds: technology.effective.map((tech) => tech.id),
    seedStringValue: randomSeedString,
    negativeConstraints,
    estimatedTokens: estimateTokens(content) + estimateTokens(systemInstruction),
    composedByLLM: false,
  };
}

/** Junta las restricciones base de la tecnica con las del proyecto, sin duplicados. */
function mergeConstraints(base: readonly string[], own: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...base, ...own]) {
    const text = item.trim();
    const key = text.toLowerCase();
    if (text.length === 0 || seen.has(key)) continue;
    seen.add(key);
    merged.push(text);
  }
  return merged;
}

/**
 * Direccion visual. Solo lleva lo que el brief fija de verdad (proyectos
 * creados cuando el asistente aun tenia el paso de estilo): ni lineas en
 * blanco ni valores por defecto del esquema presentados como una eleccion.
 * Si algo queda sin fijar, lo dice y delega la decision en quien redacta.
 */
function renderVisualDirection(
  project: Project,
  discover: DiscoverInsights | null | undefined,
  seed: string | null,
): string {
  const { style, colors, typography, sophistication, references, avoid } = project.visual;
  const lines: string[] = [];

  if (style.trim()) lines.push(`- Estilo: ${style.trim()}`);
  if (colors.length > 0) lines.push(`- Colores: ${colors.join(', ')}`);
  if (typography.trim()) lines.push(`- Tipografia: ${typography.trim()}`);
  // 3 es el valor por defecto del esquema y el asistente ya no pregunta por la
  // sofisticacion: solo un valor distinto de 3 pudo elegirlo alguien.
  if (sophistication !== 3) lines.push(`- Nivel de sofisticacion (1-5): ${sophistication}`);
  if (references.length > 0) lines.push('- Referencias:', ...references.map((item) => `  - ${item}`));
  if (avoid.length > 0) lines.push('- Evitar explicitamente:', ...avoid.map((item) => `  - ${item}`));

  const fixedByUser = lines.length > 0;
  const explored = discover?.visualDirections ?? [];
  if (explored.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      'Direcciones visuales planteadas en el analisis DISCOVER (desarrolla una o combinalas con criterio):',
      ...explored.map((item) => `  - ${item}`),
    );
  }

  const basis = seed ? 'derivada de la Seed String (seccion SEED STRING)' : 'a partir del nicho y del publico del proyecto';
  if (lines.length > 0) lines.push('');
  lines.push(
    fixedByUser
      ? `Lo que no este fijado arriba (estilo, paleta o tipografia) lo decides tu, ${basis}.`
      : `El encargo no fija estilo, paleta ni tipografia: la direccion visual es decision tuya, ${basis}.`,
  );

  return lines.join('\n');
}

/**
 * Requisitos de copy. El mensaje principal, las caracteristicas y los beneficios
 * solo aparecen si el brief los trae; lo que falta se delega en una sola linea
 * "Contenido" (antes el mensaje principal caia a la descripcion entera, de hasta
 * 1200 caracteres, presentada como si fuera la frase que debe quedarse el lector).
 */
function renderCopyRequirements(project: Project): string {
  const { tone, keyMessage, features, benefits } = project.content;
  const derived = [
    ...(keyMessage.trim() ? [] : ['el mensaje principal']),
    ...(features.length > 0 ? [] : ['las caracteristicas']),
    ...(benefits.length > 0 ? [] : ['los beneficios']),
  ];
  const derivedText =
    derived.length <= 1 ? derived.join('') : `${derived.slice(0, -1).join(', ')} y ${derived[derived.length - 1]}`;

  return [
    `- Tono: ${tone}`,
    ...(keyMessage.trim() ? [`- Mensaje principal: ${keyMessage.trim()}`] : []),
    ...(features.length > 0 ? [`- Caracteristicas: ${features.join(', ')}`] : []),
    ...(benefits.length > 0 ? [`- Beneficios: ${benefits.join(', ')}`] : []),
    ...(derived.length > 0 ? [`- Contenido: deduce ${derivedText} de la descripcion del producto.`] : []),
    '',
    'Todo el texto es definitivo y coherente con el proyecto. Ningun marcador de posicion.',
  ].join('\n');
}

/**
 * Arquitectura de informacion fijada por el usuario: la de DEFINE o la del
 * brief. `null` si nadie la fijo: entonces la decide quien redacta el prompt.
 * Antes habia una lista generica de 7 secciones; era igual para todos los
 * proyectos y superaba el tope de 6 de "Diseno sustractivo".
 */
function resolveArchitecture(project: Project, define: DefineSpec | null | undefined): SectionSpec[] | null {
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

  return null;
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
