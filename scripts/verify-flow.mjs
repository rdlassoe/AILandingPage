/**
 * Verificacion del criterio de aceptacion, de punta a punta.
 *
 *   1. npm run dev          (en otra terminal, sin Supabase ni claves de IA)
 *   2. npm run verify:flow
 *
 * Recorre: crear proyecto -> DISCOVER -> componer prompt -> generar -> validar
 * -> auditar -> refinar -> variante -> versiones -> biblioteca -> reutilizar,
 * y comprueba ademas el aislamiento entre cuentas, el 401 sin sesion y el 422
 * ante entrada invalida.
 *
 * Usa la sesion del modo local construyendo la misma cookie que emite
 * `startLocalSession`. Sale con codigo 1 si alguna comprobacion falla.
 */
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg('base', 'http://localhost:3000');
/** Proveedor con el que ejecutar: mock (por defecto), gemini, groq u ollama. */
const PROVIDER = arg('provider', 'mock');
const MODEL = arg('model', '');
/**
 * Segundos de espera entre llamadas que consumen LLM. El valor por defecto
 * basta para el modo demo y para Gemini; Groq en capa gratuita limita a 8000
 * tokens por minuto, asi que ahi hacen falta pausas de ~60 s.
 */
const PAUSE = Number(arg('pause', PROVIDER === 'groq' ? '65' : '3.5')) * 1000;
const llm = MODEL ? { providerId: PROVIDER, model: MODEL } : { providerId: PROVIDER };

console.log(`Servidor: ${BASE}  |  proveedor: ${PROVIDER}${MODEL ? ' (' + MODEL + ')' : ''}
`);

const email = 'e2e@estudio.test';
const id = `local-${Buffer.from(email.toLowerCase(), 'utf8').toString('hex').slice(0, 24)}`;
const cookie =
  'als_local_session=' +
  Buffer.from(JSON.stringify({ id, email, displayName: 'E2E' }), 'utf8').toString('base64url');

let failures = 0;
const log = (ok, label, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

async function call(method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ...payload };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Pausa entre pasos que consumen cuota del proveedor. */
const pause = async () => {
  if (PAUSE >= 10_000) console.log(`      (esperando ${Math.round(PAUSE / 1000)} s por la cuota del proveedor)`);
  await sleep(PAUSE);
};

const run = async () => {
  // 1. Crear proyecto
  const created = await call('POST', '/api/projects', {
    basics: {
      name: 'Taller de encuadernacion Vela',
      theme: 'encuadernacion artesanal por encargo',
      description:
        'Un taller que encuaderna tesis, cuadernos de campo y archivos familiares a mano. La pagina explica que se puede encargar, cuanto tarda y cuanto cuesta.',
      landingType: 'service',
      targetAudience: 'investigadores y particulares que quieren conservar documentos en papel',
      primaryGoal: 'recibir solicitudes de presupuesto con el documento adjunto',
      productOrService: 'encuadernacion artesanal por encargo',
      primaryCta: 'Pedir presupuesto',
    },
    visual: {
      style: 'Editorial sobrio, con la materia prima en primer plano',
      colors: ['#1b1a17', '#c0563a'],
      typography: 'Serif de lectura con monoespaciada para datos',
      sophistication: 4,
      references: [],
      avoid: ['Fotografia de stock'],
    },
    technical: {
      technologyIds: ['html5', 'css3', 'javascript', 'lucide'],
      framework: null,
      libraries: [],
      constraints: ['Sin dependencias externas'],
    },
    content: {
      sections: ['Hero', 'Propuesta de valor', 'Caracteristicas', 'Como funciona', 'FAQ', 'CTA final'],
      features: ['Cosido a mano', 'Papel libre de acido', 'Entrega en 15 dias'],
      benefits: ['El documento dura decadas', 'Cada encargo se fotografia antes de entregarse'],
      keyMessage: 'Tu documento, cosido a mano y hecho para durar',
      tone: 'sobrio',
    },
    seedStringId: 'seed-documentary-tech',
    seedStringValue: null,
    negativeConstraints: [
      'Sin degradados morados ni azul-a-violeta.',
      'Sin fotografia de stock corporativa.',
      'Sin copy generico de IA.',
    ],
  });
  log(created.status === 200 && !!created.data?.id, 'POST /api/projects', `status=${created.status}`);
  const projectId = created.data?.id;
  if (!projectId) return;

  // 2. DISCOVER -> DEFINE
  const discover = await call('POST', '/api/discover', { projectId, ...llm });
  log(
    discover.status === 200 && discover.data?.discover?.niche && discover.data?.define?.informationArchitecture?.length > 0,
    'POST /api/discover',
    `secciones IA=${discover.data?.define?.informationArchitecture?.length ?? 0}`,
  );

  // 3. Composicion del prompt
  const prompt = await call('POST', '/api/prompts/generate', { projectId });
  const built = prompt.data;
  log(prompt.status === 200 && built?.sections?.length === 17, 'POST /api/prompts/generate', `secciones=${built?.sections?.length}`);
  log(built?.seedStringValue?.includes('documental') === true, 'Seed String incorporada al prompt');
  log(built?.content?.includes('## NEGATIVE CONSTRAINTS') === true, 'Seccion NEGATIVE CONSTRAINTS presente');
  log(built?.content?.includes('## SUBTRACTIVE DESIGN') === true, 'Seccion SUBTRACTIVE DESIGN presente');
  log(built?.content?.includes('Lucide') === true, 'Instrucciones de la tecnologia Lucide compuestas');

  // 4. Generar
  await pause();
  const generated = await call('POST', '/api/generations', { projectId, ...llm });
  const landing = generated.data?.landingPage;
  log(generated.status === 200 && !!landing?.id, 'POST /api/generations', `status=${generated.status}`);
  if (!landing) return;
  log(landing.html.startsWith('<!DOCTYPE html>'), 'Salida validada empieza por <!DOCTYPE html>');
  log(landing.html.trimEnd().endsWith('</html>'), 'Salida validada termina en </html>');
  if (PROVIDER === 'mock') {
    log(landing.isMock === true && landing.providerId === 'mock', 'Generacion marcada como demo (no se atribuye a Gemini/Groq)');
  } else {
    log(
      landing.isMock === false && landing.providerId === PROVIDER,
      `Generacion atribuida a ${PROVIDER}, no al modo demo`,
      `modelo=${landing.model}`,
    );
    log(landing.html.length > 4000, 'La pagina generada tiene cuerpo suficiente', `${landing.html.length} caracteres`);
  }
  log(landing.currentVersion === 1, 'Landing creada en v1');

  // 5. Critica
  await pause();
  const review = await call('POST', '/api/generations/critique', { landingPageId: landing.id, ...llm });
  const issues = review.data?.issues ?? [];
  log(review.status === 200 && issues.length > 0, 'POST /api/generations/critique', `issues=${issues.length}`);
  log((review.data?.suggestions ?? []).length > 0, 'El critico propone acciones concretas');
  const scoreBefore = review.data?.scores?.overall ?? 0;

  // 6. Refinar aceptando todas las recomendaciones
  await pause();
  const refined = await call('POST', '/api/generations/refine', {
    landingPageId: landing.id,
    reviewId: review.data.id,
    acceptedSuggestionIds: review.data.suggestions.map((s) => s.id),
    ...llm,
  });
  const refinedLanding = refined.data?.landingPage;
  log(refined.status === 200 && refinedLanding?.currentVersion === 2, 'POST /api/generations/refine', `v${refinedLanding?.currentVersion}`);
  if (PROVIDER === 'mock') {
    log(
      refinedLanding?.html.includes('og:title') && refinedLanding?.html.includes('application/ld+json'),
      'El refinamiento aplico las mejoras aceptadas',
    );
  } else {
    log(
      (refinedLanding?.html ?? '') !== landing.html,
      'El refinamiento produjo una pagina distinta a la original',
    );
  }

  // 7. Segunda critica: debe mejorar
  await pause();
  const review2 = await call('POST', '/api/generations/critique', { landingPageId: landing.id, ...llm });
  const scoreAfter = review2.data?.scores?.overall ?? 0;
  if (PROVIDER === 'mock') {
    log(
      review2.status === 200 && (review2.data?.issues?.length ?? 99) < issues.length,
      'La segunda auditoria encuentra menos problemas',
      `${issues.length} -> ${review2.data?.issues?.length} (score ${scoreBefore} -> ${scoreAfter})`,
    );
  } else {
    // Con un modelo real la critica no es determinista: se comprueba que
    // vuelve a auditar correctamente, no que baje un numero concreto.
    log(
      review2.status === 200 && Array.isArray(review2.data?.issues),
      'La segunda auditoria se ejecuta sobre la version refinada',
      `${issues.length} -> ${review2.data?.issues?.length} (score ${scoreBefore} -> ${scoreAfter})`,
    );
  }

  // 8. Variante
  await pause();
  const variant = await call('POST', '/api/generations/variation', {
    landingPageId: landing.id,
    strategy: 'same-content-new-seed',
    ...llm,
  });
  log(
    variant.status === 200 && variant.data?.landingPage?.id !== landing.id,
    'POST /api/generations/variation crea una Landing Page independiente',
  );

  // 9. Versiones y trazabilidad prompt <-> landing
  const versions = await call('GET', `/api/landings/${landing.id}/versions`);
  log((versions.data ?? []).length === 2, 'Historial de versiones', `versiones=${(versions.data ?? []).length}`);
  log(!!refinedLanding?.promptVersionId, 'La landing conserva la version de prompt que la produjo');

  // 10. Biblioteca y filtros
  const library = await call('GET', '/api/landings');
  log((library.data ?? []).length === 2, 'GET /api/landings', `paginas=${(library.data ?? []).length}`);
  const filtered = await call('GET', '/api/landings?technology=lucide');
  log((filtered.data ?? []).length >= 1, 'Filtro por tecnologia');

  // 11. Reutilizacion
  const reused = await call('POST', `/api/landings/${landing.id}/reuse`, {});
  log(reused.status === 200 && reused.data?.projectId && reused.data.projectId !== projectId, 'POST /api/landings/[id]/reuse');

  // 12. Busqueda global
  const search = await call('GET', '/api/search?q=encuadernacion');
  log((search.data?.projects ?? []).length > 0, 'GET /api/search');

  // 13. Aislamiento entre cuentas
  const otherEmail = 'intruso@estudio.test';
  const otherId = `local-${Buffer.from(otherEmail, 'utf8').toString('hex').slice(0, 24)}`;
  const otherCookie =
    'als_local_session=' +
    Buffer.from(JSON.stringify({ id: otherId, email: otherEmail, displayName: 'Intruso' }), 'utf8').toString('base64url');
  const leak = await fetch(`${BASE}/api/projects/${projectId}`, { headers: { cookie: otherCookie } });
  log(leak.status === 403 || leak.status === 404, 'Un usuario no puede leer el proyecto de otro', `status=${leak.status}`);

  // 14. Sin sesion
  const anon = await fetch(`${BASE}/api/projects`);
  log(anon.status === 401, 'Sin sesion la API responde 401', `status=${anon.status}`);

  // 15. Validacion de entrada
  const invalid = await call('POST', '/api/projects', { basics: { name: 'x' } });
  log(invalid.status === 422, 'Entrada invalida rechazada con 422', `status=${invalid.status}`);

  console.log('\n' + (failures === 0 ? 'TODO CORRECTO' : `${failures} COMPROBACIONES FALLIDAS`));
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('ERROR', error);
  process.exit(1);
});
