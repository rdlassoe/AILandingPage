/**
 * Servidor que imita la API REST de Cloudflare Workers AI para generar imagenes.
 *
 *   node scripts/stub-cloudflare.mjs [--port=8788]
 *
 * Sirve para probar TODO el flujo de imagenes (cliente, reintentos, cuota,
 * almacenamiento, API) sin gastar neuronas ni salir a la red. La app lo usa si
 * se arranca con:
 *
 *   CLOUDFLARE_API_BASE_URL=http://localhost:8788
 *   CLOUDFLARE_ACCOUNT_ID=stub-account
 *   CLOUDFLARE_API_TOKEN=stub-token
 *
 * El comportamiento lo decide una palabra clave en el prompt:
 *
 *   (nada)          -> PNG valido de 64x64, con un color segun el prompt
 *   __quota__       -> 429 con codigo 4006 (cuota diaria agotada)
 *   __quota3036__   -> 429 con codigo 3036 (el documentado)
 *   __busy__        -> 429 con codigo 3040 siempre
 *   __busy_once__   -> 429 con codigo 3040 la primera vez por prompt; luego OK
 *   __server__      -> 500
 *   __server_once__ -> 500 la primera vez por prompt; luego OK
 *   __fail_twice__  -> 500 las dos primeras veces por prompt (un intento y su reintento); luego OK
 *   __auth__        -> 403 con codigo 5018
 *   __slow__        -> responde tras 4 s
 *   __garbage__     -> 200 con un base64 que no es una imagen
 *   __huge__        -> 200 con una imagen de mas de 6 MB
 *   __nosuccess__   -> 200 con success:false y sin imagen
 *
 * Tambien se puede importar (`startStub`) desde los scripts de verificacion,
 * que llevan la cuenta de peticiones en `stub.calls`.
 */
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

export const STUB_ACCOUNT = 'stub-account';
export const STUB_TOKEN = 'stub-token';

/* --------------------------------- PNG --------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG RGB de un solo color, valido de verdad (se abre en cualquier visor). */
export function makePng(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // profundidad de bits
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function colorFor(prompt) {
  let hash = 0;
  for (const char of prompt) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return [60 + (hash % 160), 60 + ((hash >> 8) % 160), 60 + ((hash >> 16) % 160)];
}

/* -------------------------------- servidor -------------------------------- */

export function startStub({ port = 0 } = {}) {
  const calls = [];
  const seen = new Map();

  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (piece) => chunks.push(piece));
    request.on('end', async () => {
      const send = (status, payload) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };
      const fail = (status, code, message) =>
        send(status, { success: false, result: null, errors: [{ code, message }], messages: [] });

      const url = new URL(request.url ?? '/', 'http://stub');
      const match = /^\/accounts\/([^/]+)\/ai\/run\/(.+)$/.exec(url.pathname);
      if (request.method !== 'POST' || !match) return fail(404, 7000, 'No route for that URI');

      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return fail(400, 3003, 'Invalid JSON body');
      }
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      calls.push({ account: match[1], model: decodeURIComponent(match[2]), prompt, steps: body.steps });

      if (request.headers.authorization !== `Bearer ${STUB_TOKEN}`) return fail(403, 10000, 'Authentication error');
      if (prompt.length === 0) return fail(400, 5004, 'prompt is required');

      const count = (seen.get(prompt) ?? 0) + 1;
      seen.set(prompt, count);

      if (prompt.includes('__quota__')) {
        return fail(429, 4006, 'you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare\'s Workers Paid plan if you would like to continue usage.');
      }
      if (prompt.includes('__quota3036__')) {
        return fail(429, 3036, 'You have used up your daily free allocation of 10,000 neurons.');
      }
      if (prompt.includes('__busy__') || (prompt.includes('__busy_once__') && count === 1)) {
        return fail(429, 3040, 'Capacity temporarily exceeded, please try again.');
      }
      if (
        prompt.includes('__server__') ||
        (prompt.includes('__server_once__') && count === 1) ||
        // Falla el intento y su reintento: la imagen queda pendiente; al reintentarla a mano sale bien.
        (prompt.includes('__fail_twice__') && count <= 2)
      ) {
        return fail(500, 3007, 'Internal server error');
      }
      if (prompt.includes('__auth__')) return fail(403, 5018, 'Account does not have access to this model');
      if (prompt.includes('__slow__')) await new Promise((resolve) => setTimeout(resolve, 4000));

      if (prompt.includes('__garbage__')) {
        return send(200, { success: true, result: { image: Buffer.from('esto no es una imagen, solo texto '.repeat(6)).toString('base64') }, errors: [], messages: [] });
      }
      if (prompt.includes('__nosuccess__')) return send(200, { success: false, result: null, errors: [], messages: [] });
      if (prompt.includes('__huge__')) {
        const png = makePng(64, 64, [10, 10, 10]);
        const padded = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);
        return send(200, { success: true, result: { image: padded.toString('base64') }, errors: [], messages: [] });
      }

      const png = makePng(64, 64, colorFor(prompt));
      return send(200, { success: true, result: { image: png.toString('base64') }, errors: [], messages: [] });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: actualPort,
        baseUrl: `http://localhost:${actualPort}`,
        calls,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/* ---------------------------------- CLI ---------------------------------- */

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  const portArg = process.argv.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : 8788;
  const stub = await startStub({ port });
  console.log(`Stub de Cloudflare Workers AI en ${stub.baseUrl}
  CLOUDFLARE_API_BASE_URL=${stub.baseUrl}
  CLOUDFLARE_ACCOUNT_ID=${STUB_ACCOUNT}
  CLOUDFLARE_API_TOKEN=${STUB_TOKEN}
Ctrl+C para parar.`);
}
