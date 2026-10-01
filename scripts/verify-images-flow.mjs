/**
 * Recorrido de extremo a extremo de la tecnica "Generacion de imagenes", contra
 * un servidor de desarrollo REAL y un Cloudflare simulado (nunca gasta cuota).
 *
 *   1. node scripts/stub-cloudflare.mjs            (terminal 1)
 *   2. servidor en modo local y demo, con el stub:  (terminal 2)
 *        NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY=
 *        CLOUDFLARE_API_BASE_URL=http://localhost:8788
 *        CLOUDFLARE_ACCOUNT_ID=stub-account CLOUDFLARE_API_TOKEN=stub-token
 *        (p. ej. en `.env.development.local`, ver docs/ENVIRONMENT.md) y `npm run dev`
 *   3. npm run verify:images-flow                   (terminal 3)
 *
 * Con el modo demo como proveedor de texto, la pagina deja un marcador
 * `<img data-ai-image>` en el hero y el servidor lo rellena llamando a
 * Cloudflare (el stub): es el mismo camino que con Gemini o Groq.
 *
 * Comprueba: el prompt pide marcadores; la generacion los resuelve con una URL
 * corta y sin incrustar bytes; la ruta de la imagen funciona SIN cookie (como
 * la ve el iframe sandbox) y rechaza ids que no son uuid; un fallo deja un
 * marcador visible y el reintento lo completa creando la version "Imagenes";
 * refinar conserva la imagen; el guardado manual acepta el HTML con URLs.
 *
 * Sale con codigo 1 si alguna comprobacion falla.
 */
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg('base', 'http://localhost:3000');
console.log(`Servidor: ${BASE}\n`);

const email = 'e2e-images@estudio.test';
const id = `local-${Buffer.from(email.toLowerCase(), 'utf8').toString('hex').slice(0, 24)}`;
const cookie =
  'als_local_session=' +
  Buffer.from(JSON.stringify({ id, email, displayName: 'E2E imagenes' }), 'utf8').toString('base64url');

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

const projectPayload = (theme) => ({
  basics: {
    name: 'Taller de ceramica Faro',
    theme,
    description: 'Un taller que ensena ceramica a adultos por las tardes y vende piezas hechas a mano en pequenas series.',
    landingType: 'service',
    targetAudience: 'adultos de ciudad que buscan un oficio manual sin experiencia previa',
    primaryGoal: 'reservar plaza en el proximo curso de iniciacion',
    productOrService: 'cursos de ceramica de iniciacion',
    primaryCta: 'Reservar plaza',
  },
  visual: {
    style: 'Editorial sobrio, con la materia prima en primer plano',
    colors: ['#1b1a17', '#c0563a'],
    typography: 'Serif de lectura con monoespaciada para datos',
    sophistication: 4,
    references: [],
    avoid: ['Fotografia de stock'],
  },
  technical: { technologyIds: ['html5', 'css3', 'javascript'], framework: null, libraries: [], constraints: [] },
  content: {
    sections: ['Hero', 'Propuesta de valor', 'Caracteristicas', 'FAQ', 'CTA final'],
    features: ['Grupos de seis personas', 'Horno propio'],
    benefits: ['Sales con una pieza terminada'],
    keyMessage: 'Aprende ceramica con las manos, sin prisa',
    tone: 'sobrio',
  },
  negativeConstraints: ['Sin degradados morados ni azul-a-violeta.'],
});

const IMAGE_URL = /\/api\/landing-images\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

async function generateWithImages(theme) {
  const created = await call('POST', '/api/projects', projectPayload(theme));
  const projectId = created.data?.id;
  if (!projectId) throw new Error(`No se pudo crear el proyecto (${created.status}): ${JSON.stringify(created.error)}`);

  const composed = await call('POST', '/api/prompts/compose', {
    projectId,
    providerId: 'mock',
    designTechniques: ['image-generation'],
  });
  const generated = await call('POST', '/api/generations', {
    projectId,
    promptVersionId: composed.data?.promptVersionId,
    providerId: 'mock',
  });
  return { projectId, composed, generated };
}

const run = async () => {
  /* ------------------ 1. exito: marcador -> imagen real ------------------ */
  const ok = await generateWithImages('ceramica de iniciacion para adultos');
  log(
    ok.composed.status === 200 && ok.composed.data?.built?.content?.includes('data-ai-image'),
    'El prompt compuesto con la tecnica pide marcadores <img data-ai-image>',
  );
  log(ok.generated.status === 200, 'POST /api/generations (demo + imagenes)', `status=${ok.generated.status}`);

  const landing = ok.generated.data?.landingPage;
  const images = ok.generated.data?.images;
  log(
    images?.total === 1 && images.ready === 1 && images.generated === 1 && images.pending === 0,
    'El informe dice 1 de 1 imagenes generada',
    JSON.stringify(images),
  );

  const match = IMAGE_URL.exec(landing?.html ?? '');
  log(!!match, 'El HTML guardado lleva una URL corta /api/landing-images/<uuid>');
  log(
    !/base64,/.test(landing?.html ?? '') && !(landing?.html ?? '').includes('__pending'),
    'El HTML no lleva bytes incrustados ni marcadores pendientes',
  );
  if (!match) return;

  // Sin cookie: es como la pide el iframe sandbox de la vista previa y de la biblioteca.
  const bare = await fetch(`${BASE}/api/landing-images/${match[1]}`);
  const bytes = Buffer.from(await bare.arrayBuffer());
  log(
    bare.status === 200 && bare.headers.get('content-type') === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'GET de la imagen SIN cookie: 200, image/png y una firma PNG valida',
    `status=${bare.status} bytes=${bytes.length}`,
  );
  log(
    (bare.headers.get('cache-control') ?? '').includes('immutable') && bare.headers.get('x-content-type-options') === 'nosniff',
    'La imagen se sirve con cache inmutable y nosniff',
  );
  log((await fetch(`${BASE}/api/landing-images/..%2F..%2F.env.local`)).status === 404, 'Un id que no es uuid (../) responde 404');
  log((await fetch(`${BASE}/api/landing-images/${randomUuid()}`, { redirect: 'manual' })).status === 404, 'Un uuid desconocido responde 404 (modo local)');

  /* --------- 2. el resto del flujo acepta el HTML con URLs cortas --------- */
  const fetched = await call('GET', `/api/landings/${landing.id}`);
  log(fetched.status === 200 && IMAGE_URL.test(fetched.data?.html ?? ''), 'GET /api/landings/[id] devuelve el HTML con la URL de la imagen');

  const noop = await call('POST', `/api/landings/${landing.id}/images`, {});
  log(noop.status === 200 && noop.data?.changed === false && noop.data?.images?.pending === 0, 'Reintentar sin pendientes: no hace nada ni crea version');

  const refined = await call('POST', '/api/generations/refine', {
    landingPageId: landing.id,
    acceptedSuggestionIds: [],
    extraInstructions: 'Refuerza el contraste del boton principal.',
    providerId: 'mock',
  });
  const refinedMatch = IMAGE_URL.exec(refined.data?.landingPage?.html ?? '');
  log(refined.status === 200 && refinedMatch?.[1] === match[1], 'Refinar conserva la imagen ya generada (misma URL, sin volver a pedirla)', `status=${refined.status}`);

  const edited = await call('PUT', `/api/landings/${landing.id}/html`, {
    html: (refined.data?.landingPage?.html ?? landing.html).replace('</body>', '<!-- editado a mano --></body>'),
  });
  log(edited.status === 200 && edited.data?.changed === true && IMAGE_URL.test(edited.data?.landing?.html ?? ''), 'El guardado manual acepta el HTML con URLs de imagen');

  /* -------- 3. fallo: marcador visible, y el reintento lo completa -------- */
  const failed = await generateWithImages('ceramica __fail_twice__ de iniciacion');
  const failedLanding = failed.generated.data?.landingPage;
  const failedImages = failed.generated.data?.images;
  log(failed.generated.status === 200, 'Si la imagen falla, la generacion NO falla', `status=${failed.generated.status}`);
  log(
    failedImages?.total === 1 && failedImages.pending === 1 && failedImages.ready === 0 && typeof failedImages.reason === 'string',
    'El informe dice 0 de 1 y explica por que',
    JSON.stringify(failedImages),
  );
  log(
    !IMAGE_URL.test(failedLanding?.html ?? '') && (failedLanding?.html ?? '').includes('IMAGEN PENDIENTE') && (failedLanding?.html ?? '').includes('data:image/svg+xml'),
    'La pagina queda con bloque neutro y un comentario con el prompt (nunca una imagen falsa)',
  );
  const warnings = (failed.generated.data?.validation?.issues ?? []).filter((issue) => issue.code === 'image_step');
  log(warnings.length > 0, 'El fallo llega a la interfaz como aviso del validador', warnings[0]?.message ?? '');

  const before = failedLanding?.currentVersion;
  const retried = await call('POST', `/api/landings/${failedLanding?.id}/images`, {});
  log(
    retried.status === 200 && retried.data?.changed === true && retried.data?.images?.pending === 0 && IMAGE_URL.test(retried.data?.landing?.html ?? ''),
    'Reintentar imagenes completa el marcador pendiente',
    `status=${retried.status}`,
  );
  log(retried.data?.landing?.currentVersion === before + 1 && !(retried.data?.landing?.html ?? '').includes('IMAGEN PENDIENTE'), 'El reintento crea una version nueva y limpia el marcador');

  const versions = await call('GET', `/api/landings/${failedLanding?.id}/versions`);
  log((versions.data ?? []).some((version) => version.label === 'Imagenes'), 'El historial guarda la version "Imagenes"');

  const other = await fetch(`${BASE}/api/landings/${failedLanding?.id}/images`, { method: 'POST' });
  log(other.status === 401, 'Reintentar sin sesion responde 401', `status=${other.status}`);
};

function randomUuid() {
  return '00000000-0000-4000-8000-000000000000';
}

run()
  .catch((error) => {
    failures += 1;
    console.log(`FAIL  ${error.message}`);
  })
  .finally(() => {
    console.log(failures === 0 ? '\nTODO CORRECTO' : `\n${failures} comprobacion(es) fallida(s)`);
    process.exit(failures === 0 ? 0 : 1);
  });
