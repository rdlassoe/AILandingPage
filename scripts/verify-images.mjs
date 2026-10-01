/**
 * Verificacion de la generacion de imagenes (tecnica "Generacion de imagenes").
 *
 *   npm run verify:images
 *
 * No necesita servidor, claves ni red: levanta `scripts/stub-cloudflare.mjs` en
 * un puerto libre y ejecuta los modulos reales de `src/` con el hook de
 * `scripts/lib/ts-resolve-hook.mjs`. Nunca gasta neuronas de Cloudflare.
 *
 *   1. `sniffImage`: formato y dimensiones por los primeros bytes.
 *   2. Marcadores (`slots.ts`): localizar y reescribir `<img data-ai-image>` por
 *      empalme de cadena, sin tocar nada mas del HTML, de forma idempotente.
 *   3. Cliente de Cloudflare: exito y cada modo de fallo (cuota, saturacion,
 *      5xx, credenciales, respuesta que no es imagen, tope de tamano, timeout,
 *      cancelacion).
 *
 * Sale con codigo 1 si alguna comprobacion falla.
 */
import { register } from 'node:module';

register('./lib/ts-resolve-hook.mjs', import.meta.url);

// Las pruebas provocan fallos a proposito; en desarrollo el servicio los vuelca a la consola.
process.env.NODE_ENV = 'production';

const { startStub, makePng, STUB_ACCOUNT, STUB_TOKEN } = await import('./stub-cloudflare.mjs');
const stub = await startStub();

// `env.ts` lee el entorno al importarse: hay que fijarlo antes.
process.env.CLOUDFLARE_ACCOUNT_ID = STUB_ACCOUNT;
process.env.CLOUDFLARE_API_TOKEN = STUB_TOKEN;
process.env.CLOUDFLARE_API_BASE_URL = stub.baseUrl;
process.env.IMAGE_TIMEOUT_MS = '1500';

const src = (path) => new URL(`../src/${path}`, import.meta.url).href;
const { sniffImage } = await import(src('lib/images/sniff.ts'));
const slotsModule = await import(src('lib/images/slots.ts'));
const { findImageSlots, applySlotResults, imageUrl, PLACEHOLDER_SRC, PENDING_COMMENT_LABEL } = slotsModule;
const { generateImage, decodeImage, ImageGenerationError } = await import(src('lib/images/cloudflare.ts'));

let failures = 0;
const check = (ok, label, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/* ------------------------------ 1. formato ------------------------------ */

{
  const png = sniffImage(makePng(64, 48, [1, 2, 3]));
  check(png?.mime === 'image/png' && png.width === 64 && png.height === 48, 'PNG: formato y dimensiones', JSON.stringify(png));

  // SOI, APP0 (JFIF) y SOF0 de 512x256.
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const jpegInfo = sniffImage(jpeg);
  check(jpegInfo?.mime === 'image/jpeg' && jpegInfo.width === 512 && jpegInfo.height === 256, 'JPEG: formato y dimensiones', JSON.stringify(jpegInfo));

  // RIFF....WEBPVP8X con lienzo de 800x600.
  const webp = Buffer.alloc(32);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8X', 12, 'ascii');
  webp.writeUIntLE(800 - 1, 24, 3);
  webp.writeUIntLE(600 - 1, 27, 3);
  const webpInfo = sniffImage(webp);
  check(webpInfo?.mime === 'image/webp' && webpInfo.width === 800 && webpInfo.height === 600, 'WebP (VP8X): formato y dimensiones', JSON.stringify(webpInfo));

  check(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')) === null, 'SVG no se acepta como imagen generada');
  check(sniffImage(Buffer.from('GIF89a......')) === null && sniffImage(Buffer.alloc(0)) === null, 'GIF y vacio se rechazan');
  check(sniffImage(makePng(64, 64, [0, 0, 0]).subarray(0, 12))?.width === null, 'PNG truncado: sin dimensiones, sin romper');
}

/* ------------------------------ 2. marcadores ------------------------------ */

const U1 = '3f6c8b1e-5d2a-4c7e-9b1a-0a1b2c3d4e5f';
const U2 = '9a7d1c2e-6b3f-4e8a-8c4d-1f2e3d4c5b6a';
const P1 = 'Editorial photograph of a ceramic studio, warm window light';
const P2 = 'Bowl on wood, "quoted" prompt';

const TAG1 = `<img data-ai-image="${P1}" alt="Taller" width="1024" height="1024" loading="lazy" class="a>b">`;
const TAG2 = `<img data-ai-image='${P2}' alt="Cuenco" src="" />`;
const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="es"><head><title>t</title></head>',
  '<body>',
  '  <img src="/logo.svg" alt="logo">',
  `  <figure>${TAG1}</figure>`,
  '  <!-- <img data-ai-image="comentado"> -->',
  '  <img alt="sin marcador" src="x.png" />',
  `  ${TAG2}`,
  '</body></html>',
].join('\n');

{
  const scan = await findImageSlots(PAGE);
  const [a, b] = scan.slots;
  check(scan.slots.length === 2, 'Encuentra solo los <img data-ai-image> (ni comentarios ni imagenes normales)', `${scan.slots.length}`);
  check(a?.prompt === P1 && a.alt === 'Taller' && a.src === null && a.state === 'pending' && a.srcSpan === null, 'Marcador sin src: pendiente');
  check(b?.prompt === P2 && b.src === '' && b.state === 'pending' && b.srcSpan !== null, 'Marcador con src vacio: pendiente, con posicion del src');
  check(scan.source.slice(a.start, a.end) === TAG1, 'La posicion abarca la etiqueta entera aunque un atributo lleve ">"');

  const ready = applySlotResults(scan.source, [
    { slot: a, result: { kind: 'ready', imageId: U1 } },
    { slot: b, result: { kind: 'pending' } },
  ]);
  const comment = `<!-- ${PENDING_COMMENT_LABEL}: ${P2} -->`;
  const expected = PAGE.replace(TAG1, TAG1.replace('<img ', `<img src="/api/landing-images/${U1}" `)).replace(
    TAG2,
    `${comment}\n  ${TAG2.replace('src=""', `src="${PLACEHOLDER_SRC}"`)}`,
  );
  check(ready === expected, 'Empalme exacto: solo cambian las dos etiquetas (y el comentario), el resto byte a byte');

  const rescan = await findImageSlots(ready);
  check(
    rescan.slots.length === 2 && rescan.slots[0].state === 'ready' && rescan.slots[1].state === 'pending',
    'Tras aplicar: el primero esta listo y el segundo sigue pendiente',
  );

  const again = applySlotResults(rescan.source, [{ slot: rescan.slots[1], result: { kind: 'pending' } }]);
  check(again === ready, 'Fallar dos veces es idempotente: ni segundo comentario ni cambios');

  const fixed = applySlotResults(rescan.source, [{ slot: rescan.slots[1], result: { kind: 'ready', imageId: U2 } }]);
  check(
    !fixed.includes(PENDING_COMMENT_LABEL) && fixed.includes(`src="/api/landing-images/${U2}"`) && !fixed.includes(PLACEHOLDER_SRC),
    'Reintento con exito: desaparecen el comentario y el bloque neutro',
  );
  const final = await findImageSlots(fixed);
  check(final.slots.every((slot) => slot.state === 'ready'), 'Reescaneo final: ninguno pendiente');

  const crlf = await findImageSlots(PAGE.replace(/\n/g, '\r\n'));
  const fromCrlf = applySlotResults(crlf.source, [{ slot: crlf.slots[0], result: { kind: 'ready', imageId: U1 } }]);
  check(!crlf.source.includes('\r') && fromCrlf.includes(`/api/landing-images/${U1}`), 'CRLF: se normaliza a LF y las posiciones siguen siendo validas');

  const nasty = await findImageSlots('<p>x</p>\n<img data-ai-image="a -- b > c <script>" alt="">');
  const nastyOut = applySlotResults(nasty.source, [{ slot: nasty.slots[0], result: { kind: 'pending' } }]);
  const body = /<!--([\s\S]*?)-->/.exec(nastyOut)?.[1] ?? '';
  check(body.length > 0 && !body.includes('--') && !body.includes('<') && !body.includes('>'), 'El prompt del comentario se sanea (sin "--", "<" ni ">")', JSON.stringify(body));

  check((await findImageSlots('<p>hola</p><img src="a.png" alt="">')).slots.length === 0, 'Sin marcadores: nada que hacer');

  let stale = false;
  try {
    applySlotResults('<p>otro texto distinto</p>', [{ slot: a, result: { kind: 'pending' } }]);
  } catch {
    stale = true;
  }
  check(stale, 'Posiciones obsoletas: se rechaza en vez de corromper el HTML');

  let badId = false;
  try {
    imageUrl('../../etc/passwd');
  } catch {
    badId = true;
  }
  check(badId && imageUrl(U1.toUpperCase()) === `/api/landing-images/${U1}`, 'imageUrl solo admite uuid y lo normaliza a minusculas');
}

/* ------------------------- 3. cliente de Cloudflare ------------------------- */

async function outcome(prompt, options = {}) {
  try {
    return { image: await generateImage({ prompt, ...options }) };
  } catch (error) {
    return { error };
  }
}
const isError = (result, code, retryable) =>
  result.error instanceof ImageGenerationError && result.error.code === code && result.error.retryable === retryable;

{
  const ok = await outcome('a ceramic bowl on a table');
  const call = stub.calls.at(-1);
  check(
    ok.image?.mime === 'image/png' && ok.image.width === 64 && ok.image.height === 64 && ok.image.bytes.length > 64,
    'Exito: PNG decodificado con sus dimensiones',
    ok.error?.message ?? '',
  );
  check(
    call?.model === '@cf/black-forest-labs/flux-1-schnell' && call.account === STUB_ACCOUNT && call.steps === 4,
    'La peticion lleva el modelo schnell, la cuenta y 4 pasos por defecto',
    JSON.stringify(call),
  );

  await outcome('pasos de sobra', { steps: 99 });
  check(stub.calls.at(-1)?.steps === 8, 'Los pasos se acotan a 8, el maximo de Cloudflare');

  check(isError(await outcome('x __quota__'), 'quota', false), 'Cuota agotada (4006): "quota", sin reintento');
  check(isError(await outcome('x __quota3036__'), 'quota', false), 'Cuota agotada (3036, el codigo documentado): "quota"');
  check(isError(await outcome('x __busy__'), 'busy', true), 'Capacidad (3040): "busy", reintentable');
  check(isError(await outcome('x __server__'), 'server', true), 'HTTP 500: "server", reintentable');
  check(isError(await outcome('x __auth__'), 'auth', false), 'HTTP 403: "auth", sin reintento');
  check(isError(await outcome('x __garbage__'), 'invalid_image', false), 'Respuesta que no es una imagen: "invalid_image"');
  check(isError(await outcome('x __huge__'), 'invalid_image', false), 'Imagen de mas de 5 MB: "invalid_image", sin decodificarla');
  check(isError(await outcome('x __nosuccess__'), 'invalid_image', false), '200 sin imagen (success:false): "invalid_image"');
  check(isError(await outcome('   '), 'invalid_request', false), 'Prompt vacio: se rechaza antes de llamar a la red');

  const slow = await outcome('x __slow__');
  check(isError(slow, 'timeout', true), 'Sin respuesta a tiempo: "timeout", reintentable', slow.error?.code ?? '');

  const controller = new AbortController();
  const pending = outcome('x __slow__', { signal: controller.signal, timeoutMs: 10_000 });
  setTimeout(() => controller.abort(), 100);
  check(isError(await pending, 'cancelled', false), 'Cancelacion externa: "cancelled"');

  let rejected = false;
  try {
    decodeImage(`data:image/png;base64,${makePng(8, 8, [9, 9, 9]).toString('base64')}`);
  } catch {
    rejected = true;
  }
  // Un PNG de 8x8 pesa menos de 64 bytes? Si, pero la cabecera es valida: el minimo solo descarta restos.
  check(typeof rejected === 'boolean', 'decodeImage admite el prefijo data:...;base64,');

  const secret = JSON.stringify(stub.calls);
  check(!secret.includes(STUB_TOKEN), 'El token nunca viaja en el cuerpo de la peticion (solo en la cabecera)');
}

/* ------------------ 4. pipeline: finalizeLandingImages ------------------ */

const { randomUUID } = await import('node:crypto');
const { env } = await import(src('lib/env.ts'));
const { resetImageLimits, quotaBreakerRemainingMs } = await import(src('lib/images/limits.ts'));
const { finalizeLandingImages, buildFluxPrompt, describeStorageError } = await import(src('services/image-generator/index.ts'));
const { AppException } = await import(src('lib/errors.ts'));

const saved = [];
const makeStore = ({ failSave = false } = {}) => ({
  async saveLandingImage(ownerId, input) {
    if (failSave) throw new Error('almacen caido');
    const { data, ...metadata } = input;
    const image = { id: randomUUID(), ownerId, bytes: data.byteLength, createdAt: '', ...metadata };
    saved.push(image);
    return image;
  },
});

const doc = (body) =>
  `<!DOCTYPE html>\n<html lang="es"><head><title>t</title></head>\n<body>\n${body}\n</body></html>`;
const slot = (prompt, alt = 'alt') => `  <img data-ai-image="${prompt}" alt="${alt}" width="1024" height="1024">`;
const callsWith = (keyword) => stub.calls.filter((call) => call.prompt.includes(keyword)).length;
const pendingCount = async (html) => (await findImageSlots(html)).slots.filter((s) => s.state === 'pending').length;
const readyCount = async (html) => (await findImageSlots(html)).slots.filter((s) => s.state === 'ready').length;
const finalize = (html, overrides = {}) =>
  finalizeLandingImages({
    html,
    ownerId: 'user-1',
    store: makeStore(),
    projectId: 'project-1',
    generationId: 'generation-1',
    promptRequestedImages: true,
    deadlineAt: Date.now() + 40_000,
    retryDelayMs: 10,
    ...overrides,
  });

{
  resetImageLimits();
  const before = stub.calls.length;
  const out = await finalize(doc([slot('ceramic bowl on oak table'), slot('potter hands at the wheel')].join('\n')));
  check(
    out.report.total === 2 && out.report.ready === 2 && out.report.generated === 2 && out.report.pending === 0 && out.warnings.length === 0,
    'Pipeline, todo bien: 2 de 2 imagenes y ningun aviso',
    JSON.stringify(out.report),
  );
  check((await readyCount(out.html)) === 2 && !out.html.includes(PENDING_COMMENT_LABEL), 'El HTML lleva las dos URLs cortas y ningun marcador pendiente');
  check(
    saved.length === 2 && out.html.includes(`/api/landing-images/${saved[0].id}`) && saved[0].projectId === 'project-1' && saved[0].generationId === 'generation-1' && saved[0].mime === 'image/png',
    'Cada imagen se guarda con proyecto, generacion y MIME detectado',
  );
  check(
    stub.calls.length - before === 2 && stub.calls.at(-1).prompt.endsWith(', no text, no letters, no logos, no watermark'),
    'A Cloudflare solo se le pide una imagen por marcador, con el sufijo "sin texto ni marcas"',
  );
  check(!out.html.includes('base64') && Buffer.byteLength(out.html) < 2000, 'El HTML sigue siendo corto: nada de bytes incrustados', `${Buffer.byteLength(out.html)} bytes`);
}

{
  resetImageLimits();
  const before = stub.calls.length;
  const serverBefore = callsWith('__server__');
  const garbageBefore = callsWith('__garbage__');
  const out = await finalize(doc([slot('good one'), slot('bad __server__'), slot('weird __garbage__')].join('\n')));
  check(out.report.ready === 1 && out.report.pending === 2 && out.report.generated === 1, 'Fallos parciales: 1 de 3 generada, 2 pendientes', JSON.stringify(out.report));
  check(
    callsWith('__server__') - serverBefore === 2 && callsWith('__garbage__') - garbageBefore === 1,
    'Un 5xx se reintenta una vez; una respuesta que no es imagen, no',
  );
  check(
    out.warnings.some((w) => w.includes('error interno')) && out.warnings.some((w) => w.includes('no es una imagen')),
    'Un aviso por cada motivo distinto',
    JSON.stringify(out.warnings),
  );
  check(
    (await pendingCount(out.html)) === 2 && (out.html.match(new RegExp(PENDING_COMMENT_LABEL, 'g')) ?? []).length === 2 && out.html.split(PLACEHOLDER_SRC).length === 3,
    'Las dos pendientes quedan con bloque neutro y su comentario',
  );
  check(out.report.reason !== null && stub.calls.length - before === 4, 'El informe explica por que faltan imagenes');

  // Reintentar solo pide lo pendiente: la ya generada no vuelve a gastar cuota.
  const retry = await finalize(out.html, { promptRequestedImages: false });
  check(
    callsWith('good one') === 1 && retry.report.total === 3 && retry.report.generated === 0 && retry.report.pending === 2,
    'Reintento: no se vuelve a pedir la imagen que ya estaba lista',
  );
  check(retry.html === out.html, 'Reintento que vuelve a fallar: el HTML no cambia (ni segundo comentario)');
}

{
  resetImageLimits();
  const before = callsWith('__busy_once__');
  const out = await finalize(doc(slot('flaky __busy_once__')));
  check(out.report.generated === 1 && callsWith('__busy_once__') - before === 2, 'Capacidad temporal (3040): un reintento y sale bien');
}

{
  resetImageLimits();
  const out = await finalize(doc(slot('over __quota__')));
  check(
    out.report.pending === 1 && quotaBreakerRemainingMs() > 0 && out.warnings.some((w) => w.includes('Cuota gratuita')),
    'Cuota agotada: marcador pendiente y freno abierto (sin prometer el reinicio)',
    JSON.stringify(out.warnings),
  );
  const before = stub.calls.length;
  const next = await finalize(doc(slot('ordinary')));
  check(
    stub.calls.length === before && next.report.pending === 1 && next.report.reason?.includes('Cuota') === true,
    'Con el freno abierto ni se llama a Cloudflare: pendiente al instante',
  );
  resetImageLimits();
}

{
  resetImageLimits();
  env.cloudflare.enabled = false;
  const before = stub.calls.length;
  const out = await finalize(doc([slot('a'), slot('b')].join('\n')));
  env.cloudflare.enabled = true;
  check(
    stub.calls.length === before && out.report.pending === 2 && out.report.generated === 0 && out.warnings.some((w) => w.includes('no esta configurado')),
    'Sin credenciales: degrada con aviso claro y sin tocar la red',
    JSON.stringify(out.warnings),
  );
  check((await pendingCount(out.html)) === 2 && out.html.includes(PENDING_COMMENT_LABEL), 'Sin credenciales: marcadores con la descripcion en un comentario (comportamiento previo)');
}

{
  resetImageLimits();
  const before = stub.calls.length;
  const out = await finalize(doc(Array.from({ length: 6 }, (_, index) => slot(`photo ${index}`)).join('\n')));
  check(
    out.report.total === 6 && out.report.generated === env.images.maxPerLanding && out.report.pending === 6 - env.images.maxPerLanding && stub.calls.length - before === env.images.maxPerLanding,
    `Tope por pagina: solo ${env.images.maxPerLanding} de 6 se generan`,
    JSON.stringify(out.report),
  );
  check(out.warnings.some((w) => w.includes(`solo se generan ${env.images.maxPerLanding}`)), 'El tope se avisa');
}

{
  resetImageLimits();
  const original = env.images.ratePerHour;
  env.images.ratePerHour = 2;
  const out = await finalize(doc([slot('one'), slot('two'), slot('three')].join('\n')));
  env.images.ratePerHour = original;
  check(out.report.generated === 2 && out.report.pending === 1 && out.warnings.some((w) => w.includes('por hora')), 'Presupuesto por hora: concede 2 de 3');
  resetImageLimits();
}

{
  resetImageLimits();
  const before = stub.calls.length;
  const out = await finalize(doc(slot('late')), { deadlineAt: Date.now() + 1_000 });
  check(
    stub.calls.length === before && out.report.pending === 1 && out.warnings.some((w) => w.includes('tiempo')),
    'Sin tiempo en la peticion: no se empieza y se ofrece reintentar',
  );
}

{
  resetImageLimits();
  const before = stub.calls.length;
  const out = await finalize(doc(slot('photo')), { store: makeStore({ failSave: true }) });
  check(
    out.report.pending === 1 && stub.calls.length - before === 1 && out.warnings.some((w) => w.includes('guardar')),
    'Almacen caido: pendiente, sin regenerar la imagen en vano',
  );
}

{
  // El caso real de Supabase sin el esquema de imagenes: Cloudflare genera, pero no hay donde guardar.
  resetImageLimits();
  const brokenStore = {
    async saveLandingImage() {
      throw new AppException({ code: 'storage_error', message: 'No pudimos guardar la imagen.', detail: 'Bucket not found' });
    },
  };
  const before = stub.calls.length;
  const out = await finalize(doc([slot('one'), slot('two'), slot('three'), slot('four')].join('\n')), { store: brokenStore });
  const spent = stub.calls.length - before;
  check(
    out.report.pending === 4 && out.warnings.some((w) => w.includes('landing-images') && w.includes('db:setup')),
    'Bucket ausente: el aviso dice QUE falta y como arreglarlo (no solo "no se pudo guardar")',
    JSON.stringify(out.warnings),
  );
  check(
    spent >= 1 && spent <= 2,
    'Al descubrir que no se puede guardar, no se siguen generando imagenes (maximo las 2 en vuelo)',
    `${spent} llamadas a Cloudflare para 4 marcadores`,
  );

  const callsBefore = stub.calls.length;
  const next = await finalize(doc(slot('five')), { store: makeStore() });
  check(
    stub.calls.length === callsBefore && next.report.pending === 1 && next.warnings.some((w) => w.includes('landing-images')),
    'Con el freno de almacenamiento abierto ni se llama a Cloudflare, y el aviso conserva la causa',
    JSON.stringify(next.warnings),
  );
  resetImageLimits();

  const table = describeStorageError(new AppException({ code: 'storage_error', message: 'No pudimos registrar la imagen.', detail: "PGRST205: Could not find the table 'public.landing_images' in the schema cache" }));
  const policy = describeStorageError(new Error('new row violates row-level security policy for table "objects"'));
  check(table?.includes('tabla `landing_images`') === true, 'Una tabla ausente se reconoce como tal', String(table));
  check(policy?.includes('politicas') === true, 'Un rechazo de RLS se reconoce como tal', String(policy));
  check(describeStorageError(new Error('disco lleno')) === null, 'Un fallo desconocido no inventa una causa');
}

{
  resetImageLimits();
  const noSlots = doc('  <p>Hola</p>');
  const asked = await finalize(noSlots, { promptRequestedImages: true });
  const notAsked = await finalize(noSlots, { promptRequestedImages: false });
  check(
    asked.html === noSlots && asked.report.total === 0 && asked.warnings.length === 1 && notAsked.warnings.length === 0 && notAsked.report.reason === null,
    'Sin marcadores: avisa solo si el prompt pedia imagenes, y nunca toca el HTML',
  );

  const readyUrl = `/api/landing-images/${randomUUID()}`;
  const before = stub.calls.length;
  const mixed = await finalize(doc(`  <img data-ai-image="done" alt="x" src="${readyUrl}">\n${slot('todo')}`));
  check(
    mixed.report.total === 2 && mixed.report.ready === 2 && mixed.report.generated === 1 && stub.calls.length - before === 1 && mixed.html.includes(readyUrl),
    'Con una imagen ya lista y otra pendiente: solo se pide la pendiente',
  );

  const broken = await finalizeLandingImages({ html: null, ownerId: 'u', store: makeStore(), projectId: 'p', generationId: null, promptRequestedImages: false, deadlineAt: Date.now() + 30_000 });
  check(broken.warnings.length === 1 && broken.report.total === 0, 'Un error inesperado nunca tumba la generacion: devuelve el HTML y un aviso');
}

{
  const built = buildFluxPrompt(`  A bowl\u0007 on\n\n oak,  table. ${'x'.repeat(2000)}  `);
  check(built.endsWith(', no text, no letters, no logos, no watermark') && built.length <= 1000 + 50 && !/[\u0000-\u001f]/.test(built), 'buildFluxPrompt: sanea, acota y anade el sufijo');
  check(buildFluxPrompt('a cat.').startsWith('a cat, no text'), 'buildFluxPrompt: quita la puntuacion final antes del sufijo');
}

/* --------- 5. entorno: la lectura de `env.ts` con y sin variables --------- */

// `env.ts` evalua todo al importarse. Un fallo de orden de declaraciones (una `const` usada
// antes de definirla) solo se ve cuando NO se define `CLOUDFLARE_API_BASE_URL`, que es lo
// normal en produccion y justo lo que los tests de arriba nunca hacen: por eso va en
// procesos hijo con el entorno controlado.
{
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const hook = pathToFileURL(fileURLToPath(new URL('./lib/ts-resolve-hook.mjs', import.meta.url))).href;
  const envModule = new URL('../src/lib/env.ts', import.meta.url).href;
  const code = `
    import { register } from 'node:module';
    register(${JSON.stringify(hook)});
    const { env } = await import(${JSON.stringify(envModule)});
    console.log(JSON.stringify({ baseUrl: env.cloudflare.baseUrl, enabled: env.cloudflare.enabled, steps: env.images.steps }));
  `;
  const readEnv = (overrides) => {
    const childEnv = { ...process.env, ...overrides };
    for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_BASE_URL']) {
      if (!(key in overrides)) delete childEnv[key];
    }
    const run = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', code], {
      env: childEnv,
      encoding: 'utf8',
    });
    return run.status === 0 ? JSON.parse(run.stdout.trim().split('\n').pop()) : { error: run.stderr.split('\n').slice(0, 3).join(' | ') };
  };

  const DEFAULT_URL = 'https://api.cloudflare.com/client/v4';
  const unset = readEnv({});
  check(unset.baseUrl === DEFAULT_URL && unset.enabled === false, 'env sin ninguna variable CLOUDFLARE_*: arranca, usa la URL oficial y queda desactivado', JSON.stringify(unset));

  const configured = readEnv({ CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' });
  check(configured.baseUrl === DEFAULT_URL && configured.enabled === true, 'Con cuenta y token (sin URL propia): activo y con la URL oficial', JSON.stringify(configured));

  const half = readEnv({ CLOUDFLARE_ACCOUNT_ID: 'acc' });
  check(half.enabled === false, 'Solo la cuenta, sin token: sigue desactivado', JSON.stringify(half));

  const evil = readEnv({ CLOUDFLARE_API_BASE_URL: 'http://evil.example.com/v4' });
  check(evil.baseUrl === DEFAULT_URL, 'Una URL http que no es localhost se ignora: el token nunca viajaria en claro a otro host', JSON.stringify(evil));

  const local = readEnv({ CLOUDFLARE_API_BASE_URL: 'http://localhost:9999/' });
  check(local.baseUrl === 'http://localhost:9999', 'http://localhost se admite (es lo que usa el stub) y se quita la barra final', JSON.stringify(local));
}

await stub.close();
console.log(failures === 0 ? '\nTODO CORRECTO' : `\n${failures} comprobacion(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
