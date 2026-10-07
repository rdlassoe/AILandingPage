/**
 * Verifica las credenciales de proveedores guardadas desde Ajustes.
 *
 *   npm run verify:credentials
 *
 * No necesita servidor, claves ni red: ejecuta los modulos reales de `src/lib/credentials`,
 * los adaptadores y el cliente de Cloudflare con un almacen simulado en memoria y un `fetch`
 * interceptado. NO toca `.data/` (ni `db.json` ni `credentials.key`): la clave maestra sale de
 * `CREDENTIALS_ENCRYPTION_KEY`, fijada aqui antes de cargar nada.
 *
 *   1. Cifrado: ida y vuelta, IV nuevo cada vez, alteraciones, otra cuenta, otra clave.
 *   2. Validacion de cada campo (y la URL de Ollama solo en modo local: SSRF).
 *   3. Resolucion: la clave del usuario gana a la del entorno, y sin ella se usa el entorno.
 *   4. Estado para la interfaz: nunca trae un valor, solo origen y ultimos 4 caracteres.
 *   5. Guardar y borrar: cambios parciales, todo-o-nada, aislamiento entre cuentas.
 *   6. Robustez: una base caida o ilegible no rompe nada.
 *   7. Que de verdad se usa la clave DEL USUARIO en cada peticion (Gemini, Groq, Ollama, Cloudflare).
 *
 * Sale con codigo 1 si alguna comprobacion falla.
 */
import { register } from 'node:module';

// Antes de importar nada: `env.ts` lee el entorno al cargarse.
process.env.CREDENTIALS_ENCRYPTION_KEY = 'clave-maestra-solo-para-las-pruebas-0123456789';
process.env.GEMINI_API_KEY = 'ENV-gemini-key-aaaa1111';
process.env.GROQ_API_KEY = '';
process.env.CLOUDFLARE_ACCOUNT_ID = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.CLOUDFLARE_API_BASE_URL = '';
process.env.OLLAMA_BASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';

register('./lib/ts-resolve-hook.mjs', import.meta.url);

const src = (path) => new URL(`../src/${path}`, import.meta.url).href;
const credentials = await import(src('lib/credentials/index.ts'));
const crypto = await import(src('lib/credentials/crypto.ts'));
const { envCredentials, getRuntimeConfigSummary, env } = await import(src('lib/env.ts'));
const { GeminiProvider } = await import(src('lib/llm/gemini-provider.ts'));
const { GroqProvider } = await import(src('lib/llm/groq-provider.ts'));
const { OllamaProvider } = await import(src('lib/llm/ollama-provider.ts'));
const { resolveProvider, listProviderStatuses } = await import(src('lib/llm/registry.ts'));
const { generateImage, isImageGenerationConfigured } = await import(src('lib/images/cloudflare.ts'));
const { AppException } = await import(src('lib/errors.ts'));

let failures = 0;
const check = (ok, label, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};
const rejects = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
};

/** Almacen en memoria con la misma interfaz que `DataStore` para credenciales. */
function fakeStore() {
  const store = {
    blobs: new Map(),
    failing: false,
    async getCredentialsBlob(userId) {
      if (store.failing) throw new AppException({ code: 'storage_error', message: 'No pudimos leer tus credenciales.', hint: 'Ejecuta npm run db:setup.' });
      return store.blobs.get(userId) ?? null;
    },
    async saveCredentialsBlob(userId, blob) {
      if (store.failing) throw new AppException({ code: 'storage_error', message: 'No pudimos guardar tus credenciales.' });
      if (blob === null) store.blobs.delete(userId);
      else store.blobs.set(userId, blob);
    },
  };
  return store;
}

const U1 = 'usuario-uno';
const U2 = 'usuario-dos';
const GEMINI_USER = 'USER-gemini-key-bbbb2222';
const GROQ_USER = 'gsk_USERgroqkey_cccc3333';
const CF_ACCOUNT = '0123456789abcdef0123456789abcdef';
const CF_TOKEN = 'CF-token-USER-dddd4444';

/* ------------------------------ 1. cifrado ------------------------------ */

{
  const key = Buffer.alloc(32, 7);
  const plain = JSON.stringify({ geminiApiKey: GEMINI_USER });
  const a = crypto.encryptWithKey(key, plain, U1);
  const b = crypto.encryptWithKey(key, plain, U1);

  check(crypto.decryptWithKey(key, a, U1) === plain, 'Cifrado: ida y vuelta');
  check(a !== b, 'Cifrado: un IV nuevo en cada mensaje (el mismo texto no da el mismo resultado)');
  check(!a.includes(GEMINI_USER) && a.split('.').length === 4 && a.startsWith('v1.'), 'El texto cifrado no contiene la clave y tiene formato v1.iv.tag.datos');

  const tampered = a.split('.');
  tampered[3] = (tampered[3][0] === 'A' ? 'B' : 'A') + tampered[3].slice(1);
  const e1 = await rejects(() => crypto.decryptWithKey(key, tampered.join('.'), U1));
  check(e1?.code === 'decrypt_failed', 'Un texto alterado no se descifra (GCM lo detecta)', e1?.code);

  const e2 = await rejects(() => crypto.decryptWithKey(key, a, U2));
  check(e2?.code === 'decrypt_failed', 'El texto cifrado de una cuenta no sirve en otra (el id del usuario es dato autenticado)', e2?.code);

  const e3 = await rejects(() => crypto.decryptWithKey(Buffer.alloc(32, 9), a, U1));
  check(e3?.code === 'decrypt_failed', 'Con otra clave maestra falla en lugar de devolver basura', e3?.code);

  const e4 = await rejects(() => crypto.decryptWithKey(key, 'esto-no-es-un-blob', U1));
  check(e4?.code === 'bad_blob', 'Un formato desconocido se distingue de una clave equivocada', e4?.code);

  const master = await crypto.getMasterKey();
  check(master.source === 'env' && master.key.length === 32, 'La clave maestra sale de CREDENTIALS_ENCRYPTION_KEY y mide 32 bytes');
}

/* ------------------------------ 2. validacion ------------------------------ */

{
  const n = credentials.normalizeCredentialValue;
  check(n('geminiApiKey', `  ${GEMINI_USER}  `).value === GEMINI_USER, 'Una clave valida se recorta');
  check(!n('geminiApiKey', 'corta').ok, 'Una clave de menos de 8 caracteres se rechaza');
  check(!n('groqApiKey', 'tiene espacios dentro 1234').ok, 'Una clave con espacios se rechaza (acabaria en una cabecera HTTP)');
  check(!n('groqApiKey', 'linea1\nlinea2-largo').ok && !n('groqApiKey', 'clave-larga\r\nX-Evil: 1').ok, 'Una clave con saltos de linea se rechaza (inyeccion de cabeceras)');
  check(!n('cloudflareApiToken', 'a'.repeat(401)).ok, 'Una clave de mas de 400 caracteres se rechaza');
  check(n('cloudflareAccountId', CF_ACCOUNT.toUpperCase()).value === CF_ACCOUNT, 'El Account ID son 32 hex y se normaliza a minusculas');
  check(!n('cloudflareAccountId', 'no-es-un-id').ok && !n('cloudflareAccountId', CF_ACCOUNT + 'a').ok, 'Un Account ID que no son 32 hex se rechaza');

  check(n('ollamaBaseUrl', 'http://localhost:11434/').value === 'http://localhost:11434', 'URL de Ollama valida: se quita la barra final');
  check(n('ollamaBaseUrl', 'https://mi-servidor.example.com:8443/ollama/').value === 'https://mi-servidor.example.com:8443/ollama', 'La URL de Ollama puede llevar ruta');
  for (const bad of ['ftp://x.com', 'javascript:alert(1)', 'no es una url', 'http://u:p@localhost:11434', 'http://localhost:11434/?a=1', 'http://localhost:11434/#x']) {
    check(!n('ollamaBaseUrl', bad).ok, `URL de Ollama rechazada: ${bad}`);
  }
  const shared = n('ollamaBaseUrl', 'http://localhost:11434', { supabaseEnabled: true });
  check(!shared.ok && /OLLAMA_BASE_URL/.test(shared.message), 'En modo compartido (Supabase) la URL de Ollama NO se puede cambiar (SSRF)');
  check(credentials.allowsUserOllamaUrl(false) === true && credentials.allowsUserOllamaUrl(true) === false, 'allowsUserOllamaUrl: solo en modo local');
}

/* ------------------------------ 3. resolucion ------------------------------ */

{
  const store = fakeStore();
  const before = await credentials.resolveCredentials(store, U1);
  check(before.geminiApiKey === 'ENV-gemini-key-aaaa1111' && before.groqApiKey === '', 'Sin nada guardado: se usa el entorno', JSON.stringify({ g: before.geminiApiKey, q: before.groqApiKey }));

  await credentials.saveCredentials(store, U1, { geminiApiKey: GEMINI_USER, groqApiKey: GROQ_USER });
  const after = await credentials.resolveCredentials(store, U1);
  check(after.geminiApiKey === GEMINI_USER, 'La clave guardada por el usuario gana a la del entorno');
  check(after.groqApiKey === GROQ_USER, 'Y rellena la que el entorno no tenia');

  const other = await credentials.resolveCredentials(store, U2);
  check(other.geminiApiKey === 'ENV-gemini-key-aaaa1111' && other.groqApiKey === '', 'Otro usuario NO ve la clave del primero: usa el entorno');

  await credentials.saveCredentials(store, U1, { geminiApiKey: null });
  check((await credentials.resolveCredentials(store, U1)).geminiApiKey === 'ENV-gemini-key-aaaa1111', 'Quitar la clave del usuario devuelve al respaldo del entorno');
}

/* ------------------------------ 4. estado: nunca un valor ------------------------------ */

{
  const store = fakeStore();
  await credentials.saveCredentials(store, U1, { groqApiKey: GROQ_USER, cloudflareAccountId: CF_ACCOUNT, cloudflareApiToken: CF_TOKEN });
  const status = await credentials.getCredentialsStatus(store, U1);
  const json = JSON.stringify(status);

  check(
    ![GROQ_USER, CF_TOKEN, CF_ACCOUNT, 'ENV-gemini-key-aaaa1111'].some((secret) => json.includes(secret)),
    'El estado para la interfaz no contiene ninguna clave ni el Account ID completos',
  );
  check(status.fields.groqApiKey.source === 'settings' && status.fields.groqApiKey.hint === `••••${GROQ_USER.slice(-4)}`, 'Una clave guardada: origen "settings" y solo los 4 ultimos caracteres', JSON.stringify(status.fields.groqApiKey));
  check(status.fields.geminiApiKey.source === 'env' && status.fields.geminiApiKey.hint?.endsWith('1111'), 'Una clave solo del entorno: origen "env"');
  check(status.fields.ollamaBaseUrl.source === 'none', 'Ollama sin OLLAMA_BASE_URL ni URL guardada: sin configurar (la URL por defecto no cuenta)');
  check(status.storage.available && status.storage.keySource === 'env' && !status.storage.unreadable && status.storage.problem === null, 'Estado del almacenamiento: disponible, clave de entorno');
  check(status.storage.ollamaUrlEditable === true, 'En modo local la URL de Ollama es editable');
}

/* ------------------------------ 5. guardar y borrar ------------------------------ */

{
  const store = fakeStore();
  await credentials.saveCredentials(store, U1, { geminiApiKey: GEMINI_USER });
  await credentials.saveCredentials(store, U1, { groqApiKey: GROQ_USER });
  let eff = await credentials.resolveCredentials(store, U1);
  check(eff.geminiApiKey === GEMINI_USER && eff.groqApiKey === GROQ_USER, 'Un cambio parcial no borra lo demas');

  // todo-o-nada: si un valor no vale, no se guarda ninguno
  const blobBefore = store.blobs.get(U1);
  const err = await rejects(() => credentials.saveCredentials(store, U1, { groqApiKey: 'otra-clave-valida-9999', cloudflareAccountId: 'no-valido' }));
  check(err instanceof AppException && err.code === 'validation', 'Un valor invalido se rechaza con un error de validacion', err?.code);
  check(store.blobs.get(U1) === blobBefore, 'Todo o nada: al fallar uno no se guardo ninguno de los otros');
  check(!String(err?.message).includes('no-valido'), 'El mensaje de error no repite el valor recibido');

  const ollamaErr = await rejects(() => credentials.saveCredentials(store, U1, { ollamaBaseUrl: 'ftp://x' }));
  check(ollamaErr?.code === 'validation', 'Una URL de Ollama mala se rechaza');

  await credentials.saveCredentials(store, U1, { geminiApiKey: '', groqApiKey: null });
  check(!store.blobs.has(U1), 'Quitar todo borra el texto cifrado (no queda un blob vacio)');
  eff = await credentials.resolveCredentials(store, U1);
  check(eff.geminiApiKey === 'ENV-gemini-key-aaaa1111' && eff.groqApiKey === '', 'Tras borrar todo se vuelve al entorno');

  await credentials.saveCredentials(store, U1, { groqApiKey: GROQ_USER });
  await credentials.saveCredentials(store, U2, { groqApiKey: 'gsk_OTHERuserkey_5555' });
  check((await credentials.resolveCredentials(store, U1)).groqApiKey === GROQ_USER && (await credentials.resolveCredentials(store, U2)).groqApiKey === 'gsk_OTHERuserkey_5555', 'Cada usuario conserva la suya');

  await credentials.clearCredentials(store, U1);
  check(!store.blobs.has(U1) && store.blobs.has(U2), 'clearCredentials borra solo las del usuario que lo pide');
}

/* ------------------------------ 6. robustez ------------------------------ */

{
  // el texto cifrado de otra cuenta, copiado a esta: no se puede leer
  const store = fakeStore();
  await credentials.saveCredentials(store, U1, { groqApiKey: GROQ_USER });
  store.blobs.set(U2, store.blobs.get(U1));
  const stolen = await credentials.resolveCredentials(store, U2);
  const stolenStatus = await credentials.getCredentialsStatus(store, U2);
  check(stolen.groqApiKey === '' && stolenStatus.storage.unreadable === true, 'Un texto cifrado copiado a otra cuenta no se lee: queda como ilegible y se usa el entorno');

  // basura en el almacen
  store.blobs.set(U2, 'basura');
  check((await credentials.resolveCredentials(store, U2)).geminiApiKey === 'ENV-gemini-key-aaaa1111', 'Un texto ilegible no rompe: se usa el entorno');
  const replaced = await credentials.saveCredentials(store, U2, { groqApiKey: 'gsk_NEWkeyafterbroken_6666' });
  check(replaced.storage.unreadable === false && replaced.fields.groqApiKey.source === 'settings', 'Guardar una clave nueva sustituye lo ilegible');

  // base de datos caida (p. ej. falta la columna)
  const down = fakeStore();
  down.failing = true;
  let eff = null;
  const thrown = await rejects(async () => {
    eff = await credentials.resolveCredentials(down, U1);
  });
  check(!thrown && eff?.geminiApiKey === 'ENV-gemini-key-aaaa1111', 'Si la base no responde, resolveCredentials NO lanza: usa el entorno (no puede tumbar la aplicacion)', thrown?.message ?? '');
  const dstatus = await credentials.getCredentialsStatus(down, U1);
  check(dstatus.storage.available === false && /db:setup/.test(dstatus.storage.problem ?? ''), 'El estado dice por que no se puede guardar y que hacer (db:setup)', dstatus.storage.problem);
  const saveErr = await rejects(() => credentials.saveCredentials(down, U1, { groqApiKey: GROQ_USER }));
  check(saveErr instanceof AppException && saveErr.code === 'storage_error', 'Intentar guardar con la base caida da un error claro, no un fallo mudo');
}

/* ------------------------------ 7. se usa la clave del usuario ------------------------------ */

{
  const realFetch = globalThis.fetch;
  const calls = [];
  const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
    if (String(url).includes('generativelanguage')) return ok({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: {} });
    if (String(url).includes('groq.com') || String(url).includes('11434') || String(url).includes('mi-ollama')) return ok({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} });
    if (String(url).includes('cloudflare')) {
      // PNG minimo valido de 1x1
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      return ok({ success: true, result: { image: png.toString('base64') } });
    }
    return ok({});
  };

  try {
    const mine = { geminiApiKey: GEMINI_USER, groqApiKey: GROQ_USER, ollamaBaseUrl: 'http://mi-ollama:1234', cloudflareAccountId: CF_ACCOUNT, cloudflareApiToken: CF_TOKEN };
    const none = { geminiApiKey: '', groqApiKey: '', ollamaBaseUrl: 'http://localhost:11434', cloudflareAccountId: '', cloudflareApiToken: '' };

    await new GeminiProvider().generate({ credentials: mine, prompt: 'hola' });
    check(calls.at(-1).headers['x-goog-api-key'] === GEMINI_USER, 'Gemini envia la clave DEL USUARIO, no la del entorno', calls.at(-1).headers['x-goog-api-key']);

    await new GroqProvider().generate({ credentials: mine, prompt: 'hola' });
    check(calls.at(-1).headers.authorization === `Bearer ${GROQ_USER}`, 'Groq envia la clave DEL USUARIO');

    await new OllamaProvider().generate({ credentials: mine, prompt: 'hola' });
    check(calls.at(-1).url.startsWith('http://mi-ollama:1234/v1/chat/completions'), 'Ollama llama a la URL del usuario', calls.at(-1).url);

    await generateImage({ credentials: mine, prompt: 'a white square' });
    check(
      calls.at(-1).headers.authorization === `Bearer ${CF_TOKEN}` && calls.at(-1).url.includes(`/accounts/${CF_ACCOUNT}/ai/run/`),
      'Cloudflare usa el Account ID y el token DEL USUARIO',
      calls.at(-1).url,
    );

    const before = calls.length;
    const geminiErr = await rejects(() => new GeminiProvider().generate({ credentials: none, prompt: 'hola' }));
    const groqErr = await rejects(() => new GroqProvider().generate({ credentials: none, prompt: 'hola' }));
    const imgErr = await rejects(() => generateImage({ credentials: none, prompt: 'x' }));
    check(geminiErr?.code === 'not_configured' && groqErr?.code === 'not_configured' && imgErr?.code === 'not_configured', 'Sin credenciales efectivas, cada proveedor falla con not_configured');
    check(calls.length === before, 'Y no sale ninguna peticion de red');
    check(/Ajustes/.test(geminiErr?.hint ?? '') && /Ajustes/.test(groqErr?.hint ?? ''), 'El aviso manda a Ajustes, no solo a .env.local', geminiErr?.hint);

    check((await new GeminiProvider().testConnection(none)).status === 'not_configured', 'testConnection sin clave: not_configured, sin llamar');
    check((await new GeminiProvider().testConnection(mine)).status === 'connected', 'testConnection con la clave del usuario: connected');
  } finally {
    globalThis.fetch = realFetch;
  }

  const mine = { geminiApiKey: GEMINI_USER, groqApiKey: '', ollamaBaseUrl: 'http://localhost:11434', cloudflareAccountId: CF_ACCOUNT, cloudflareApiToken: CF_TOKEN };
  const none = { ...mine, geminiApiKey: '', cloudflareAccountId: '', cloudflareApiToken: '' };
  check(resolveProvider('gemini', mine).provider.id === 'gemini' && !resolveProvider('gemini', mine).fellBackToMock, 'resolveProvider: con la clave del usuario se usa Gemini');
  check(resolveProvider('gemini', none).provider.id === 'mock' && resolveProvider('gemini', none).fellBackToMock, 'resolveProvider: sin credenciales degrada al modo demo');
  check(listProviderStatuses(mine).find((p) => p.id === 'gemini')?.configured === true && listProviderStatuses(none).find((p) => p.id === 'gemini')?.configured === false, 'listProviderStatuses refleja las credenciales del usuario');
  check(getRuntimeConfigSummary(mine).imageGeneration.configured === true && getRuntimeConfigSummary(none).imageGeneration.configured === false, 'El resumen de imagenes necesita Account ID Y token');
  check(isImageGenerationConfigured({ cloudflareAccountId: CF_ACCOUNT, cloudflareApiToken: '' }) === false, 'Con solo el Account ID, sin token, no esta configurado');
  check(JSON.stringify(getRuntimeConfigSummary(mine)).includes(GEMINI_USER) === false, 'El resumen que viaja al cliente no lleva ninguna clave');
  check(envCredentials().geminiApiKey === 'ENV-gemini-key-aaaa1111' && env.cloudflare.enabled === false, 'El entorno sigue siendo el respaldo');
}

console.log(failures === 0 ? '\nTODO CORRECTO' : `\n${failures} comprobacion(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
