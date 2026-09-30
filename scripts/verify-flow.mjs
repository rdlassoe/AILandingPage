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
  log(
    typeof built?.seedStringValue === 'string' && built.seedStringValue.length > 0 && built?.content?.includes('## SEED STRING') === true,
    'Seed String aleatoria incorporada al prompt',
  );
  log(built?.content?.includes('## NEGATIVE CONSTRAINTS') === true, 'Seccion NEGATIVE CONSTRAINTS presente');
  log(built?.content?.includes('## SUBTRACTIVE DESIGN') === true, 'Seccion SUBTRACTIVE DESIGN presente');
  log(built?.content?.includes('Lucide') === true, 'Instrucciones de la tecnologia Lucide compuestas');

  // 3b. El prompt lleva UNICAMENTE las tecnicas elegidas (POST /api/prompts/compose,
  // el camino real del Prompt Studio). Usa el proveedor del recorrido: con `mock` es
  // el borrador determinista, con uno real pasa ademas por la reescritura del LLM.
  // Un `[]` explicito significa "ninguna tecnica", no "las de por defecto".
  const composeWith = (designTechniques) =>
    call('POST', '/api/prompts/compose', { projectId, ...llm, designTechniques });
  const none = await composeWith([]);
  const noneBuilt = none.data?.built;
  log(
    none.status === 200 &&
      !noneBuilt?.content?.includes('## SUBTRACTIVE DESIGN') &&
      !noneBuilt?.content?.includes('## SEED STRING') &&
      noneBuilt?.seedStringValue === null,
    'Sin tecnicas elegidas: el prompt no trae SUBTRACTIVE DESIGN ni SEED STRING',
    `status=${none.status} secciones=${noneBuilt?.sections?.length}`,
  );
  log(
    built?.sections?.length !== undefined && noneBuilt?.sections?.length === built.sections.length - 2,
    'Sin tecnicas elegidas: el prompt tiene exactamente las 2 secciones menos',
    `${built?.sections?.length} -> ${noneBuilt?.sections?.length}`,
  );
  await pause();
  // 'inventada' no esta en el catalogo: se ignora, no rompe ni cuenta como elegida.
  const one = await composeWith(['ambitious-prompts', 'inventada']);
  const oneBuilt = one.data?.built;
  log(
    one.status === 200 &&
      oneBuilt?.content?.includes('## SUBTRACTIVE DESIGN') === true &&
      oneBuilt?.content?.includes('sesgos cognitivos') === true &&
      !oneBuilt?.content?.includes('maximo 6 secciones') &&
      !oneBuilt?.content?.includes('## SEED STRING'),
    'Solo "Prompts Ambiciosos": aparece su texto y ninguno de las demas tecnicas',
    `status=${one.status}`,
  );

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

  // 13b. Edicion manual del HTML: `PUT /api/landings/[id]/html`
  //      Guardado real y definitivo: actualiza la pagina Y crea una version.
  const putHtml = (asCookie, html, expectedVersion) =>
    fetch(`${BASE}/api/landings/${landing.id}/html`, {
      method: 'PUT',
      headers: { cookie: asCookie, 'content-type': 'application/json' },
      body: JSON.stringify(expectedVersion === undefined ? { html } : { html, expectedVersion }),
    }).then(async (response) => ({ status: response.status, ...(await response.json().catch(() => ({}))) }));

  const current = (await call('GET', `/api/landings/${landing.id}`)).data;
  const versionBefore = current.currentVersion;
  const baseHtml = current.html;
  // El cambio quita `lang` (el critico lo detecta) y cambia el titular. Sin `lang` el documento sigue siendo valido.
  const editedHtml = baseHtml
    .replace(/<html lang="[^"]*"/i, '<html')
    .replace(/<h1>[^<]*<\/h1>/i, '<h1>Titular editado a mano</h1>');
  log(editedHtml !== baseHtml && !/<html[^>]+lang=/i.test(editedHtml), 'Preparada una edicion manual del HTML');

  const edit = await putHtml(cookie, editedHtml, versionBefore);
  log(edit.status === 200 && edit.data?.changed === true, 'PUT /api/landings/[id]/html guarda la edicion', `status=${edit.status}`);
  log(
    edit.data?.landing?.currentVersion === versionBefore + 1,
    'La edicion crea una version nueva y la deja como vigente',
    `v${versionBefore} -> v${edit.data?.landing?.currentVersion}`,
  );
  log(edit.data?.landing?.html === editedHtml, 'El HTML se guarda exactamente como se envio (sin normalizar)');
  log(edit.data?.landing?.metadata?.criticScore === null, 'La puntuacion del critico se invalida (era de otro HTML)');

  const stored = (await call('GET', `/api/landings/${landing.id}`)).data;
  log(stored?.html === editedHtml && stored?.currentVersion === versionBefore + 1, 'El cambio persiste al volver a leer la pagina');

  const versionsAfterEdit = (await call('GET', `/api/landings/${landing.id}/versions`)).data ?? [];
  log(
    versionsAfterEdit.length === versionBefore + 1 &&
      versionsAfterEdit[0]?.label === 'Edicion manual' &&
      versionsAfterEdit[0]?.html === editedHtml,
    'El historial guarda la version "Edicion manual"',
    `versiones=${versionsAfterEdit.length}`,
  );
  log(
    versionsAfterEdit[0]?.promptVersionId === current.promptVersionId,
    'La version manual conserva la version de prompt de origen (trazabilidad)',
  );

  const noop = await putHtml(cookie, editedHtml, versionBefore + 1);
  const versionsAfterNoop = (await call('GET', `/api/landings/${landing.id}/versions`)).data ?? [];
  log(
    noop.status === 200 && noop.data?.changed === false && versionsAfterNoop.length === versionsAfterEdit.length,
    'Guardar el mismo HTML no crea una version nueva',
  );

  const empty = await putHtml(cookie, '', versionBefore + 1);
  log(empty.status === 422, 'Un HTML vacio se rechaza con 422 y no se persiste', `status=${empty.status}`);
  const fragment = await putHtml(cookie, '<div>un fragmento suelto</div>', versionBefore + 1);
  log(fragment.status === 422, 'Un fragmento sin <html> se rechaza en vez de "arreglarse" en silencio', `status=${fragment.status}`);
  const afterRejected = (await call('GET', `/api/landings/${landing.id}`)).data;
  log(afterRejected?.html === editedHtml, 'Las ediciones rechazadas no tocan el HTML guardado');

  const stale = await putHtml(cookie, `${editedHtml}\n<!-- otro cambio -->`, versionBefore);
  log(stale.status === 409 && stale.error?.code === 'conflict', 'Una version base desfasada responde 409', `status=${stale.status}`);

  const otherEdit = await putHtml(otherCookie, `${editedHtml}\n<!-- intruso -->`);
  log(otherEdit.status === 403 || otherEdit.status === 404, 'Otra cuenta no puede editar una pagina privada', `status=${otherEdit.status}`);

  // Una pagina PUBLICA de otra cuenta se puede ver, pero no editar: aqui tiene que ser 403.
  await call('PATCH', `/api/landings/${landing.id}`, { status: 'public' });
  const publicEdit = await putHtml(otherCookie, `${editedHtml}\n<!-- intruso -->`);
  log(publicEdit.status === 403, 'Otra cuenta no puede editar una pagina publica (403)', `status=${publicEdit.status}`);
  await call('PATCH', `/api/landings/${landing.id}`, { status: 'private' });
  const afterIntruder = (await call('GET', `/api/landings/${landing.id}`)).data;
  log(afterIntruder?.html === editedHtml, 'El intento de otra cuenta no modifico el HTML');

  await pause();
  const reviewEdited = await call('POST', '/api/generations/critique', { landingPageId: landing.id, ...llm });
  if (PROVIDER === 'mock') {
    log(
      reviewEdited.status === 200 && (reviewEdited.data?.issues ?? []).some((issue) => /idioma/i.test(issue.title)),
      'El critico audita el HTML editado a mano (detecta el `lang` que se quito)',
    );
  } else {
    log(reviewEdited.status === 200, 'El critico se ejecuta sobre el HTML editado a mano');
  }

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
