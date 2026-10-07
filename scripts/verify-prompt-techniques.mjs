/**
 * Verifica que el prompt se genere UNICAMENTE con las tecnicas de diseno
 * seleccionadas, tambien cuando lo reescribe un LLM.
 *
 *   npm run verify:prompt
 *
 * No necesita servidor ni claves: ejecuta los modulos reales de
 * `src/services/prompt-engine/` con el hook de `scripts/lib/ts-resolve-hook.mjs`
 * y sustituye la respuesta del modelo por textos simulados. Por eso prueba lo
 * que el CODIGO garantiza frente a un modelo que no obedece, no lo que haria
 * un modelo concreto.
 *
 *   1. Borrador determinista: para las 256 combinaciones de tecnicas, el texto
 *      de una tecnica aparece si y solo si esta elegida; la Seed, tambien.
 *   2. Composicion con LLM, para varios modelos "malos": ni inventa la seccion
 *      de tecnicas, ni cuela una tecnica no elegida, ni pierde las elegidas.
 *   3. La peticion al modelo describe el borrador real (numero y titulos).
 *
 * Sale con codigo 1 si alguna comprobacion falla.
 */
import { register } from 'node:module';

register('./lib/ts-resolve-hook.mjs', import.meta.url);

const engine = await import(new URL('../src/services/prompt-engine/index.ts', import.meta.url).href);
const catalog = await import(new URL('../src/lib/data/catalog.ts', import.meta.url).href);
const discoverEngine = await import(new URL('../src/services/discover-engine/index.ts', import.meta.url).href);
const {
  buildLandingPrompt,
  buildSystemInstruction,
  composePromptViaLLM,
  DESIGN_TECHNIQUES,
  DEFAULT_TECHNIQUE_IDS,
  BASE_NEGATIVE_CONSTRAINTS,
  composeTechnologies,
  extractClaims,
  PromptRejectedError,
} = engine;

let failures = 0;
const check = (ok, label, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/* ------------------------------ fixtures ------------------------------ */

const project = {
  id: 'p1',
  basics: {
    name: 'Faro',
    theme: 'Agenda para talleres de ceramica',
    productOrService: 'Software de reservas',
    landingType: 'producto',
    description: 'Reservas y cobros para talleres pequenos.',
    primaryGoal: 'Conseguir pruebas gratuitas',
    targetAudience: 'Duenos de talleres de ceramica',
    primaryCta: 'Empezar prueba gratuita',
  },
  visual: { style: 'editorial', colors: [], typography: 'serif', sophistication: 3, references: [], avoid: [] },
  content: { tone: 'cercano', keyMessage: '', features: [], benefits: [], sections: [] },
  technical: { technologyIds: [], constraints: [] },
  negativeConstraints: ['Sin degradados morados.', 'Sin texto de relleno tipo lorem ipsum.'],
  discover: null,
  define: null,
};

const SEED = 'kQ7#vR2!xLm9$Zt4';
const ids = DESIGN_TECHNIQUES.map((technique) => technique.id);
const byId = Object.fromEntries(DESIGN_TECHNIQUES.map((technique) => [technique.id, technique]));

const draftFor = (techniqueIds) =>
  buildLandingPrompt({
    project,
    technologies: [],
    randomSeedString: SEED,
    negativeConstraints: project.negativeConstraints,
    designTechniques: techniqueIds,
    discover: null,
    define: null,
  });

const hasSection = (prompt, id) => prompt.sections.some((section) => section.id === id);
const hasTechniqueText = (text, id) => text.includes(byId[id].instruction);

// Brief tal y como lo deja el asistente de 3 pasos: sin estilo, secciones, caracteristicas ni
// restricciones. Solo quedan los valores por defecto del esquema (sofisticacion 3, tono).
const emptyProject = {
  ...project,
  visual: { style: '', colors: [], typography: '', sophistication: 3, references: [], avoid: [] },
  content: { tone: 'directo', keyMessage: '', features: [], benefits: [], sections: [] },
  negativeConstraints: [],
};
// Proyecto creado cuando el asistente aun tenia los pasos 4 y 5: sus datos se respetan.
const legacyProject = {
  ...project,
  visual: { style: 'documental, crudo', colors: ['#1b1b1b'], typography: 'grotesca condensada', sophistication: 4, references: ['Magnum'], avoid: ['stock'] },
  content: { tone: 'sobrio', keyMessage: 'Hecho a mano', features: ['Cosido a mano'], benefits: ['Dura decadas'], sections: ['Hero', 'Beneficios', 'CTA final'] },
  technical: { technologyIds: [], constraints: ['Sin cookies'] },
  negativeConstraints: ['Sin carruseles.'],
};
const draftOf = (proj, techniqueIds) =>
  buildLandingPrompt({
    project: proj,
    technologies: [],
    randomSeedString: SEED,
    negativeConstraints: proj.negativeConstraints,
    designTechniques: techniqueIds,
    discover: null,
    define: null,
  });
const sectionBody = (prompt, id) => prompt.sections.find((section) => section.id === id)?.body ?? '';
const norm = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Frases del texto BASE que antes eran versiones parciales de una tecnica
 * (auditoria de elementos, bucle de autorrevision, reglas de redaccion, antipatrones).
 * Con la regla "una tecnica solo se aplica al elegirla" no pueden aparecer nunca.
 */
const TECHNIQUE_LEAK_MARKERS = [
  'ningun elemento sin proposito',
  'compite con el',
  'antes de responder, verifica',
  'corrigelo antes de entregar',
  'sin cliches, con micro-copy',
  'usa su vocabulario',
  'identidad propia',
  'ningun patron generico',
  'clientes exigentes',
];

/* ------------------- 1. borrador: las 256 combinaciones ------------------- */

{
  let bad = 0;
  const problems = [];
  for (let mask = 0; mask < 1 << ids.length; mask += 1) {
    const selected = ids.filter((_, index) => mask & (1 << index));
    const draft = draftFor(selected);
    const fail = (why) => {
      bad += 1;
      if (problems.length < 5) problems.push(`[${selected.join(',') || 'ninguna'}] ${why}`);
    };

    for (const id of ids) {
      if (hasTechniqueText(draft.content, id) !== selected.includes(id)) fail(`texto de ${id}`);
    }
    if (hasSection(draft, 'SUBTRACTIVE_DESIGN') !== selected.length > 0) fail('seccion de tecnicas');
    const seedSelected = selected.includes('seed-strings');
    if (hasSection(draft, 'SEED_STRING') !== seedSelected) fail('seccion SEED STRING');
    if ((draft.seedStringValue !== null) !== seedSelected) fail('seedStringValue');
    if (!seedSelected && /seed/i.test(draft.content)) fail('menciona la Seed sin haberla elegido');
    // Las imagenes se piden con marcadores `data-ai-image`: solo si esta elegida la tecnica,
    // y entonces OUTPUT_FORMAT tambien deja de decir que son SVG inline.
    const imagesSelected = selected.includes('image-generation');
    if (!imagesSelected && /data-ai-image/.test(draft.content)) fail('menciona los marcadores de imagen sin elegirlos');
    const outputFormat = draft.sections.find((section) => section.id === 'OUTPUT_FORMAT')?.body ?? '';
    if (imagesSelected && !outputFormat.includes('data-ai-image')) fail('OUTPUT_FORMAT no menciona los marcadores');
    if (imagesSelected && outputFormat.includes('se sustituyen por SVG inline')) fail('OUTPUT_FORMAT contradice la tecnica de imagenes');
  }
  check(bad === 0, `Borrador respeta la seleccion en las ${1 << ids.length} combinaciones`, problems.join(' | '));
}

/* ---- 1b. restricciones negativas solo con su tecnica; texto base neutro; brief vacio ---- */

{
  const NEG = 'negative-constraints-plus';
  const problems = [];
  let bad = 0;
  for (const proj of [emptyProject, legacyProject]) {
    const label = proj === emptyProject ? 'brief vacio' : 'brief con datos';
    for (let mask = 0; mask < 1 << ids.length; mask += 1) {
      const selected = ids.filter((_, index) => mask & (1 << index));
      const draft = draftOf(proj, selected);
      const text = norm(draft.content);
      const negSelected = selected.includes(NEG);
      const fail = (why) => {
        bad += 1;
        if (problems.length < 6) problems.push(`(${label}) [${selected.join(',') || 'ninguna'}] ${why}`);
      };

      // Restricciones negativas: existen si y solo si esta elegida la tecnica.
      if (hasSection(draft, 'NEGATIVE_CONSTRAINTS') !== negSelected) fail('seccion NEGATIVE CONSTRAINTS');
      if ((draft.negativeConstraints.length > 0) !== negSelected) fail('lista negativeConstraints');
      for (const item of BASE_NEGATIVE_CONSTRAINTS) {
        if (draft.content.includes(item) !== negSelected) fail(`restriccion base "${item.slice(0, 24)}"`);
      }
      if (negSelected && proj === legacyProject && !draft.content.includes('Sin carruseles.')) fail('pierde una restriccion propia del proyecto');
      if (!negSelected && proj === legacyProject && draft.content.includes('Sin carruseles.')) fail('aplica una restriccion propia sin la tecnica');
      if (!negSelected && /restricciones? negativas?|requisitos duros/.test(text)) fail('menciona restricciones negativas sin la tecnica');
      if (!negSelected && /restricciones negativas/.test(norm(draft.systemInstruction))) fail('el sistema habla de restricciones negativas');
      if (negSelected && !/restricciones negativas/.test(norm(draft.systemInstruction))) fail('el sistema no menciona las restricciones');
      if (draft.systemInstruction !== buildSystemInstruction({ negativeConstraints: negSelected })) fail('systemInstruction');

      // Texto base neutro: ninguna version parcial de una tecnica.
      for (const marker of TECHNIQUE_LEAK_MARKERS) if (text.includes(marker)) fail(`texto base con rastro de tecnica: "${marker}"`);

      // Restricciones tecnicas: el asistente ya no las pregunta. Un proyecto nuevo no emite el bloque;
      // uno antiguo que las tenga las conserva (no son una tecnica, son datos del proyecto).
      if (proj === emptyProject && /restricciones tecnicas del proyecto/.test(text)) fail('bloque de restricciones tecnicas sin datos');
      if (proj === legacyProject && !draft.content.includes('- Sin cookies')) fail('pierde una restriccion tecnica fijada');

      // Sin valores fantasma: ni viñetas vacias ni la sofisticacion por defecto presentada como eleccion.
      // Una viñeta "- Campo:" sin valor solo es valida si le siguen subviñetas ("- Referencias:").
      if (/^[ \t]*-[ \t]+[^:\n]+:[ \t]*(?:\n(?![ \t]+-[ \t])|(?![\s\S]))/m.test(draft.content)) fail('vineta vacia');
      // (el texto de "Prompts Ambiciosos" habla de la sofisticacion del mercado: se mira la linea de VISUAL DIRECTION)
      if (proj === emptyProject && /nivel de sofisticacion \(1-5\)/.test(text)) fail('sofisticacion fantasma');
      if (proj === legacyProject && !/nivel de sofisticacion \(1-5\): 4/.test(text)) fail('pierde la sofisticacion fijada');
    }
  }
  check(bad === 0, `Restricciones negativas solo con su tecnica, base neutra y sin valores fantasma (${2 * (1 << ids.length)} borradores)`, problems.join(' | '));
}

{
  const draft = draftOf(emptyProject, DEFAULT_TECHNIQUE_IDS);
  const visual = norm(sectionBody(draft, 'VISUAL_DIRECTION'));
  const architecture = sectionBody(draft, 'INFORMATION_ARCHITECTURE');
  const copy = sectionBody(draft, 'COPY_REQUIREMENTS');
  const functional = sectionBody(draft, 'FUNCTIONAL_REQUIREMENTS');
  check(visual.includes('decision tuya') && visual.includes('seed string'), 'Brief vacio con Seed: VISUAL DIRECTION delega la decision y la liga a la Seed');
  check(
    architecture.includes('define tu la estructura') && !/^\s*\d+\./m.test(architecture),
    'Brief vacio: la arquitectura se delega (sin lista generica ni lineas numeradas)',
  );
  check(copy.includes('Contenido: deduce') && !copy.includes('Caracteristicas:'), 'Brief vacio: sin caracteristicas ni beneficios inventados');
  check(
    functional.includes('Si la pagina incluye preguntas frecuentes') && functional.includes('Si incluye un formulario'),
    'FUNCTIONAL REQUIREMENTS no exige FAQ ni formulario si la pagina no los lleva',
  );
  check(!/cifras y ejemplos/.test(norm(copy)), 'COPY REQUIREMENTS no pide cifras ni ejemplos que el brief no aporta');
  check(
    !copy.includes(emptyProject.basics.description) && !copy.includes('Mensaje principal:') && copy.includes('deduce el mensaje principal'),
    'Sin mensaje principal: no se usa la descripcion entera como si lo fuera, se delega',
  );

  const noSeed = norm(sectionBody(draftOf(emptyProject, ['subtractive-design']), 'VISUAL_DIRECTION'));
  check(noSeed.includes('nicho y del publico') && !noSeed.includes('seed'), 'Brief vacio sin Seed: la direccion visual sale del nicho y del publico');

  const legacy = draftOf(legacyProject, []);
  check(
    /^1\. Hero/m.test(sectionBody(legacy, 'INFORMATION_ARCHITECTURE')) &&
      sectionBody(legacy, 'COPY_REQUIREMENTS').includes('Caracteristicas: Cosido a mano') &&
      sectionBody(legacy, 'VISUAL_DIRECTION').includes('Estilo: documental, crudo'),
    'Proyecto con datos: se respetan secciones, caracteristicas y estilo fijados',
  );

  const explored = buildLandingPrompt({
    project: emptyProject,
    technologies: [],
    randomSeedString: null,
    negativeConstraints: [],
    designTechniques: [],
    discover: { niche: 'n', audienceInsight: '', valueProposition: 'v', context: 'c', differentiators: [], visualDirections: ['Archivo notarial', 'Taller de encuadernacion'], marketSophistication: 3, frictions: [], generatedAt: null },
    define: null,
  });
  check(
    sectionBody(explored, 'VISUAL_DIRECTION').includes('Archivo notarial'),
    'Las direcciones visuales de DISCOVER entran en el prompt (antes se descartaban)',
  );
}

/* --------------- 2. composicion con LLM: modelos que no obedecen --------------- */

const split = (content) =>
  content.split(/\n(?=## )/).map((block) => {
    const [head = '', ...rest] = block.split('\n');
    return { title: head.replace(/^##\s+/, '').trim(), body: rest.join('\n') };
  });
const join = (sections) => sections.map((section) => `## ${section.title}\n${section.body}`).join('\n\n');

async function compose(draft, techniqueIds, respond) {
  let request = null;
  globalThis.__fakeRunLLM = async (req) => {
    request = req;
    return {
      text: respond(split(draft.content)),
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      providerId: 'gemini',
      model: 'simulado',
      isMock: false,
      cacheKey: 'k',
    };
  };
  try {
    const outcome = await composePromptViaLLM({ ownerId: 'u' }, draft, { techniqueIds });
    return { built: outcome.built, request };
  } catch (error) {
    return { error, request };
  }
}

const setBody = (sections, title, body) => sections.map((s) => (s.title === title ? { ...s, body } : s));
const without = (sections, title) => sections.filter((s) => s.title !== title);

/** Comprueba que el prompt final contiene exactamente las tecnicas elegidas. */
function respectsSelection(built, selected) {
  const wrong = ids.filter((id) => hasTechniqueText(built.content, id) !== selected.includes(id));
  const techniqueSection = hasSection(built, 'SUBTRACTIVE_DESIGN');
  return { ok: wrong.length === 0 && techniqueSection === selected.length > 0, wrong, techniqueSection };
}

const NONE = [];
const ONLY_AMBITIOUS = ['ambitious-prompts'];
const DEFAULTS = DEFAULT_TECHNIQUE_IDS;

// a) el modelo lee "17 secciones" e inventa el bloque de tecnicas
{
  const draft = draftFor(NONE);
  const { built, error } = await compose(draft, NONE, (sections) => [
    ...sections,
    { title: 'SUBTRACTIVE DESIGN', body: byId['subtractive-design'].instruction },
  ].map((s) => `## ${s.title}\n${s.body}`).join('\n\n'));
  check(!error && respectsSelection(built, NONE).ok, 'Sin tecnicas: un SUBTRACTIVE DESIGN inventado se descarta', error?.message ?? '');
}

// b) el modelo inventa ademas una SEED STRING que no se eligio
{
  const draft = draftFor(ONLY_AMBITIOUS);
  const { built, error } = await compose(draft, ONLY_AMBITIOUS, (sections) =>
    join([...sections, { title: 'SEED STRING', body: '- String aleatorio: inventado' }]),
  );
  check(!error && !hasSection(built, 'SEED_STRING'), 'Sin "Cadenas Semilla": una SEED STRING inventada se descarta', error?.message ?? '');
}

// b2) sin "Restricciones negativas", el modelo inventa una seccion NEGATIVE CONSTRAINTS
{
  const selected = ['seed-strings', 'subtractive-design'];
  const draft = draftFor(selected);
  const { built, error } = await compose(draft, selected, (sections) =>
    join([...sections, { title: 'NEGATIVE CONSTRAINTS', body: '- Sin degradados morados.\n- Sin sombras.' }]),
  );
  check(
    !error && !hasSection(built, 'NEGATIVE_CONSTRAINTS') && built.negativeConstraints.length === 0,
    'Sin "Restricciones negativas": una seccion NEGATIVE CONSTRAINTS inventada se descarta',
    error?.message ?? '',
  );
}

// b3) con la tecnica, la seccion sobrevive tal cual aunque el modelo la reescriba
{
  const draft = draftFor(DEFAULT_TECHNIQUE_IDS);
  const { built, error } = await compose(draft, DEFAULT_TECHNIQUE_IDS, (sections) =>
    join(setBody(sections, 'NEGATIVE CONSTRAINTS', '- Sin nada.')),
  );
  check(
    !error &&
      BASE_NEGATIVE_CONSTRAINTS.every((item) => built.content.includes(item)) &&
      !built.content.includes('- Sin nada.'),
    'Con "Restricciones negativas": su seccion se restaura del borrador aunque el modelo la reescriba',
    error?.message ?? '',
  );
}

// c) el modelo reescribe (y pierde) el texto de las tecnicas elegidas
{
  const draft = draftFor(DEFAULTS);
  const { built, error } = await compose(draft, DEFAULTS, (sections) =>
    join(setBody(sections, 'SUBTRACTIVE DESIGN', 'Aplica diseno sustractivo con criterio.')),
  );
  const result = built ? respectsSelection(built, DEFAULTS) : { ok: false, wrong: [] };
  check(!error && result.ok, 'Con tecnicas: el bloque sobrevive intacto aunque el modelo lo reescriba', error?.message ?? result.wrong.join(','));
}

// d) el modelo se salta el bloque de tecnicas y el del stack
{
  const draft = draftFor(ONLY_AMBITIOUS);
  const { built, error } = await compose(draft, ONLY_AMBITIOUS, (sections) =>
    join(without(without(sections, 'SUBTRACTIVE DESIGN'), 'TECHNOLOGY')),
  );
  const technology = built?.sections.find((s) => s.id === 'TECHNOLOGY')?.body;
  const draftTechnology = draft.sections.find((s) => s.id === 'TECHNOLOGY')?.body;
  check(
    !error && respectsSelection(built, ONLY_AMBITIOUS).ok && technology === draftTechnology,
    'Un bloque de tecnicas o de stack omitido por el modelo se restaura del borrador',
    error?.message ?? '',
  );
}

// e) el modelo cuela el texto de una tecnica no elegida dentro de otra seccion
{
  const cases = [
    ['diseno sustractivo', 'QUALITY CRITERIA', 'Maximo 6 secciones en el cuerpo de la pagina.', NONE],
    ['video', 'VISUAL DIRECTION', 'Deja <!-- VIDEO: fondo del hero --> en el hero.', NONE],
    ['redaccion humana', 'COPY REQUIREMENTS', 'Usa longitud variable de frase para dar ritmo.', ONLY_AMBITIOUS],
    ['subagentes', 'OBJECTIVE', 'Actua como tu propio critico antes de entregar.', ['human-writing']],
    ['imagenes', 'VISUAL DIRECTION', 'Para cada foto, escribe un marcador sin atributo src.', NONE],
    ['restricciones negativas', 'VISUAL DIRECTION', 'Sin degradados morados ni azul-a-violeta.', NONE],
    ['restricciones negativas (texto de la tecnica)', 'COPY REQUIREMENTS', 'Evita los tics que delatan contenido generado por IA.', ONLY_AMBITIOUS],
  ];
  for (const [label, title, extra, selected] of cases) {
    const draft = draftFor(selected);
    const { built, error } = await compose(draft, selected, (sections) =>
      join(sections.map((s) => (s.title === title ? { ...s, body: `${s.body}\n${extra}` } : s))),
    );
    check(Boolean(error) && !built, `Tecnica no elegida (${label}) colada en ${title}: se rechaza y se cae al borrador`);
  }
}

// f) un modelo que obedece no pierde nada ni dispara falsos positivos
{
  for (const selected of [NONE, ONLY_AMBITIOUS, DEFAULTS, ids]) {
    const draft = draftFor(selected);
    const { built, error } = await compose(draft, selected, (sections) =>
      join(sections.map((s) => ({ ...s, body: `${s.body}\n(reescrito con mas detalle)` }))),
    );
    const result = built ? respectsSelection(built, selected) : { ok: false, wrong: [] };
    check(!error && result.ok, `Modelo que obedece [${selected.length} tecnicas]: sin falsos positivos`, error?.message ?? result.wrong.join(','));
  }
}

/* ------------- 3. la peticion al modelo describe el borrador real ------------- */

{
  const draft = draftFor(NONE);
  const { request } = await compose(draft, NONE, (sections) => join(sections));
  const count = draft.sections.length;
  const text = `${request?.system ?? ''}\n${request?.prompt ?? ''}`;
  check(count !== 17, 'Precondicion: sin tecnicas ni Seed el borrador no tiene 17 secciones', `tiene ${count}`);
  check(text.includes(`${count} secciones`), `La peticion pide ${count} secciones, las del borrador`);
  check(!text.includes('17 secciones'), 'La peticion no habla de 17 secciones');

  // Lo que va despues de </draft> es la lista de secciones que se le pide al modelo.
  const requested = (request?.prompt ?? '').split('</draft>')[1] ?? '';
  check(!requested.includes('SUBTRACTIVE DESIGN'), 'Sin tecnicas: SUBTRACTIVE DESIGN no esta entre las secciones pedidas');
  check(
    (request?.system ?? '').includes('NO eligio ninguna tecnica'),
    'Sin tecnicas: el sistema le dice al modelo que no hay ninguna',
  );
  check(
    !(request?.system ?? '').includes('manipular ese string') && (request?.system ?? '').includes('no eligio'),
    'Sin "Cadenas Semilla": el sistema no le pide derivar una direccion de la Seed',
  );
}

{
  const draft = draftFor(DEFAULTS);
  const { request } = await compose(draft, DEFAULTS, (sections) => join(sections));
  const requested = (request?.prompt ?? '').split('</draft>')[1] ?? '';
  check(
    requested.includes('SUBTRACTIVE DESIGN') && requested.includes('SEED STRING'),
    'Con tecnicas y Seed: ambas secciones estan entre las pedidas',
  );
  check(
    (request?.system ?? '').includes('manipular ese string') && !(request?.system ?? '').includes('NO eligio ninguna tecnica'),
    'Con tecnicas y Seed: el sistema pide derivar la direccion de la Seed',
  );
}

/* ----- 4. las reglas del compositor describen el borrador y delegan lo que el brief no fija ----- */

{
  const sys = async (selected, proj = emptyProject) =>
    (await compose(draftOf(proj, selected), selected, (sections) => join(sections))).request?.system ?? '';

  const none = await sys(NONE);
  check(
    none.includes('NO eligio restricciones negativas') && !none.includes('La seccion NEGATIVE CONSTRAINTS es la UNICA'),
    'Sin "Restricciones negativas": el sistema prohibe al modelo escribirlas',
  );
  check(!/eligio el stack, las tecnicas de diseno y las restricciones negativas/.test(none), 'Sin tecnicas: no dice que el usuario eligio restricciones');

  const withNeg = await sys(DEFAULTS);
  check(
    withNeg.includes('La seccion NEGATIVE CONSTRAINTS es la UNICA') &&
      withNeg.includes('el usuario ya eligio el stack, las tecnicas de diseno y las restricciones negativas') &&
      !withNeg.includes('NO eligio restricciones negativas'),
    'Con "Restricciones negativas": el sistema la declara decidida de antemano y unica con prohibiciones',
  );

  for (const [label, text] of [['sin tecnicas', none], ['con tecnicas', withNeg]]) {
    check(
      text.includes('es decision tuya') && text.includes('define tu la estructura') && text.includes('ni inventar hechos'),
      `Compositor (${label}): delega direccion visual, arquitectura y copy cuando el brief no las fija, sin inventar hechos`,
    );
    check(
      text.includes('FUNCTIONAL REQUIREMENTS solo puede exigir interacciones'),
      `Compositor (${label}): FUNCTIONAL REQUIREMENTS debe ser coherente con la arquitectura que escriba`,
    );
  }
}

/* ------- 5. datos inventados por el compositor: se rechazan en codigo, no solo en la peticion ------- */

{
  // Caso real: DISCOVER propuso diferenciadores que el brief no daba, y el compositor los concreto
  // ("Shopify", "5 minutos"). Se reproduce con el mismo analisis y el mismo copy del prompt que dio origen a esto.
  const discover = {
    niche: 'Software web de gestion de inventario',
    audienceInsight: 'Les preocupa perder ventas por falta de stock.',
    valueProposition: 'Controla tu stock y vende online.',
    context: 'El e-commerce crece.',
    differentiators: [
      'Integracion en tiempo real con multiples canales de venta.',
      'Soporte en espanol 24/7 y capacitacion incluida.',
      'Implementacion sin codigo y puesta en marcha en minutos.',
      'Modelo de precios escalable por transaccion.',
    ],
    visualDirections: [],
    marketSophistication: 3,
    frictions: ['Duda sobre la integracion con su plataforma actual.'],
    generatedAt: null,
  };
  const claimsProject = {
    ...emptyProject,
    basics: { ...emptyProject.basics, description: 'Prueba de 14 dias para tiendas web.', primaryCta: 'Probar 14 dias' },
  };
  const draft = buildLandingPrompt({
    project: claimsProject,
    technologies: [],
    randomSeedString: null,
    negativeConstraints: [],
    designTechniques: [],
    discover,
    define: null,
  });
  const copyOf = (sections) => sections.find((s) => s.title === 'COPY REQUIREMENTS')?.body ?? '';

  const invented = await compose(draft, [], (sections) =>
    join(
      setBody(
        sections,
        'COPY REQUIREMENTS',
        [
          '- Tono: directo',
          '- Contenido:',
          '  - Caracteristicas: 1. Integracion instantanea con Shopify, WooCommerce y marketplaces.',
          '  - 3. Configuracion sin codigo en menos de 5 minutos. Soporte 24/7 en espanol.',
          '  - FAQ: "La integracion se completa en 3 minutos". Mas de 500 clientes desde 2019, ahorra un 30 %.',
        ].join('\n'),
      ),
    ),
  );
  const message = invented.error?.message ?? '';
  check(
    invented.error instanceof PromptRejectedError && !invented.built,
    'Datos inventados en COPY REQUIREMENTS: se rechaza y se cae al borrador (con PromptRejectedError)',
    invented.error ? '' : 'se acepto',
  );
  for (const expected of ['5 minutos', '3 minutos', 'Shopify', 'WooCommerce', '500 clientes', '2019', '30 %']) {
    check(message.includes(expected), `El motivo nombra el dato inventado: ${expected}`);
  }
  check(!message.includes('24/7'), 'El motivo NO acusa "24/7": viene del analisis DISCOVER, que es parte del encargo');

  // Un modelo que solo reordena lo que el encargo ya dice no se rechaza (cifras en digitos o en letras).
  const faithful = await compose(draft, [], (sections) =>
    join(
      setBody(
        setBody(sections, 'COPY REQUIREMENTS', '- Tono: directo\n- Prueba de 14 días. Soporte en español 24/7, integración en tiempo real.'),
        'OBJECTIVE',
        'Que el visitante entienda en menos de 15 segundos que es y para quien. Prueba de catorce dias.',
      ),
    ),
  );
  check(!faithful.error && faithful.built, 'Un modelo que usa solo las cifras del encargo (en digitos o letras) no se rechaza', faithful.error?.message ?? '');

  // Lo que se vigila no incluye las secciones llenas de numeros y nombres legitimos.
  const legit = await compose(draft, [], (sections) =>
    join(
      setBody(
        setBody(sections, 'VISUAL DIRECTION', 'Paleta #0066B2 y #FF6F00, hue 207, tipografia Inter a 1.5 rem, radio 4 px, retícula de 12 columnas.'),
        'INFORMATION ARCHITECTURE',
        '1. Hero — mensaje principal.\n2. Cómo funciona — pasos.\n3. Preguntas frecuentes — dudas.\nLa sección Cómo funciona va tras el Hero.',
      ),
    ),
  );
  check(!legit.error && legit.built, 'Colores, tamanos, fuentes y nombres de seccion en VISUAL/ARQUITECTURA no son datos inventados', legit.error?.message ?? '');

  const claims = extractClaims('Mas de quince clientes, 99,9 % de disponibilidad, 5 min, desde 2020 y 24/7.');
  check(
    ['15|cliente', '999|%', '5|minuto', '2020|ano', '24/7|*'].every((key) => claims.has(key)),
    'extractClaims entiende cifras en letras y digitos, porcentajes, abreviaturas, anos y 24/7',
    [...claims.keys()].join(','),
  );
}

/* ------- 6. catalogo de tecnologias sin restricciones propias ------- */

{
  const presets = catalog.PRESET_TECHNOLOGIES.map((t) => ({ ...t, createdAt: '', updatedAt: '' }));
  const withConstraints = presets.filter((t) => t.constraints.length > 0).map((t) => t.slug);
  check(withConstraints.length === 0, 'Ninguna tecnologia del catalogo lleva restricciones', withConstraints.join(','));

  const base = composeTechnologies(['html5', 'css3', 'javascript'].map((slug) => presets.find((t) => t.slug === slug)));
  check(!base.block.includes('Restricciones tecnicas'), 'TECHNOLOGY no emite el titulo "Restricciones tecnicas" vacio');
  check(base.block.includes('- Stack: HTML5, CSS3, JavaScript ES2022'), 'El stack no repite la version del nombre ("HTML5 5")', base.block.split('\n')[0]);
  check(base.block.includes('Requisitos de salida del stack'), 'Los requisitos de salida del stack siguen en TECHNOLOGY');

  const custom = { ...presets[0], id: 'mia', slug: 'mia', name: 'Mia', version: null, constraints: ['Sin cookies de terceros.'], ownerId: 'u' };
  const withCustom = composeTechnologies([presets[0], custom]);
  check(
    withCustom.block.includes('### Restricciones tecnicas') && withCustom.block.includes('- Sin cookies de terceros.'),
    'Las restricciones de una tecnologia creada por el usuario si se respetan',
  );
}

/* ------- 7. DEFINE ya no inventa arquitectura ni criterios de accesibilidad ------- */

{
  const spec = discoverEngine.buildDefineSpec({ ...emptyProject, discover: null });
  check(spec.informationArchitecture.length === 0, 'DEFINE sin secciones en el brief: arquitectura vacia (no inventa 6)', `${spec.informationArchitecture.length}`);
  check(spec.accessibilityCriteria.length === 0, 'DEFINE no genera criterios de accesibilidad repetidos');

  const withSections = discoverEngine.buildDefineSpec({ ...emptyProject, content: { ...emptyProject.content, sections: ['Hero', 'Planes', 'Contacto'] }, discover: null });
  check(
    withSections.informationArchitecture.map((s) => s.name).join('|') === 'Hero|Planes|Contacto',
    'DEFINE con secciones en el brief: las respeta, en orden',
  );

  // Proyectos que ejecutaron DEFINE antes del cambio: tienen guardados los 6 de siempre y los 4 criterios.
  const legacyDefine = {
    informationArchitecture: catalog.LEGACY_DEFINE_DEFAULT_SECTIONS.map((name, index) => ({ id: `s${index + 1}`, name, purpose: 'p', order: index + 1, contentNotes: '', required: index === 0 })),
    visualHierarchy: '', ctaStrategy: '', copyStrategy: '', styleDirection: '',
    accessibilityCriteria: ['Contraste minimo 4.5:1 en texto de cuerpo.', 'Navegacion completa por teclado con foco visible.', 'Un unico h1 y jerarquia de encabezados sin saltos.', 'Formularios con label asociado y mensajes de error accesibles.'],
    responsiveCriteria: [], definedAt: 'x',
  };
  const stored = { ...emptyProject, define: legacyDefine };
  const old = draftOf(stored, []);
  const fresh = draftOf(emptyProject, []);
  check(
    sectionBody(old, 'INFORMATION_ARCHITECTURE') === sectionBody(fresh, 'INFORMATION_ARCHITECTURE') &&
      sectionBody(old, 'INFORMATION_ARCHITECTURE').includes('define tu la estructura'),
    'Un DEFINE antiguo (6 secciones por defecto) no predefine la arquitectura: se delega igual',
  );
  check(
    sectionBody(old, 'ACCESSIBILITY') === sectionBody(fresh, 'ACCESSIBILITY'),
    'Un DEFINE antiguo no repite sus 4 criterios en ACCESSIBILITY',
  );

  // Si el brief SI fija esas mismas secciones, es decision del usuario y se respeta.
  const explicit = { ...emptyProject, content: { ...emptyProject.content, sections: [...catalog.LEGACY_DEFINE_DEFAULT_SECTIONS] }, define: legacyDefine };
  check(/^1\. Hero/m.test(sectionBody(draftOf(explicit, []), 'INFORMATION_ARCHITECTURE')), 'Secciones fijadas por el brief (aunque coincidan con el DEFINE antiguo) se respetan');
}

/* ------- 8. DISCOVER: no se le pide inventar datos ------- */

{
  const stored = [];
  const store = {
    getProject: async () => ({ ...emptyProject, content: { ...emptyProject.content, features: ['Facturas'] } }),
    createGeneration: async () => ({ id: 'g1' }),
    updateGeneration: async () => ({}),
    updateProject: async (_owner, _id, patch) => stored.push(patch),
  };
  let request = null;
  globalThis.__fakeRunLLMJson = async (req) => {
    request = req;
    return {
      data: { niche: 'n', audienceInsight: 'a', valueProposition: 'v', context: 'c', differentiators: [], visualDirections: ['x'], marketSophistication: 3, frictions: ['f'] },
      outcome: { providerId: 'gemini', model: 'simulado', isMock: false, latencyMs: 1, inputTokens: 1, outputTokens: 1, cacheKey: 'k' },
    };
  };
  const insights = await discoverEngine.runDiscover({ ownerId: 'u', store }, 'p1', {});
  const system = request?.system ?? '';
  const prompt = request?.prompt ?? '';
  check(system.includes('No inventes datos que el encargo no aporta'), 'DISCOVER: el sistema prohibe inventar cifras, integraciones, soporte y garantias');
  check(system.includes('devuelvelo vacio'), 'DISCOVER: si el encargo no da base, el campo va vacio');
  check(!prompt.includes('3-5 diferenciadores concretos') && prompt.includes('[] si no hay ninguno'), 'DISCOVER: ya no pide "3-5 diferenciadores concretos" por narices');
  check(insights.differentiators.length === 0 && stored[0]?.discover?.differentiators?.length === 0, 'DISCOVER: una lista de diferenciadores vacia es valida y se guarda vacia');

  const withDiscover = draftOf({ ...emptyProject, discover: insights }, []);
  check(norm(sectionBody(withDiscover, 'CONTEXT')).includes('hipotesis del analisis'), 'CONTEXT presenta el analisis DISCOVER como hipotesis, no como datos del cliente');
  check(!norm(sectionBody(draftOf(emptyProject, []), 'CONTEXT')).includes('hipotesis'), 'Sin DISCOVER, CONTEXT no habla de hipotesis');
  delete globalThis.__fakeRunLLMJson;
}

console.log(failures === 0 ? '\nTODO CORRECTO' : `\n${failures} comprobacion(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
