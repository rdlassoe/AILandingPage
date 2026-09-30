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
const { buildLandingPrompt, composePromptViaLLM, DESIGN_TECHNIQUES, DEFAULT_TECHNIQUE_IDS } = engine;

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
  }
  check(bad === 0, `Borrador respeta la seleccion en las ${1 << ids.length} combinaciones`, problems.join(' | '));
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

console.log(failures === 0 ? '\nTODO CORRECTO' : `\n${failures} comprobacion(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
