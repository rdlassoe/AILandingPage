/**
 * Prueba MANUAL contra la API real de Cloudflare Workers AI (FLUX.1 schnell).
 *
 *   npm run verify:cloudflare
 *
 * GASTA CUOTA: genera 2 imagenes (1 paso y 4 pasos), del orden de 15 a 120
 * neuronas en total de las 10 000 diarias de la capa gratuita. Por eso no forma
 * parte de ninguna otra verificacion: las demas usan `scripts/stub-cloudflare.mjs`.
 *
 * Lee `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN` de `.env.local` (o del
 * entorno) y mide lo que la documentacion de Cloudflare NO dice:
 *
 *   - formato real (PNG/JPEG/WebP, por los primeros bytes) y RESOLUCION de salida;
 *   - latencia por imagen;
 *   - forma exacta de la respuesta (campos del envoltorio);
 *   - neuronas estimadas por imagen, para contrastarlas con el panel de Cloudflare
 *     (Workers AI -> Usage) y saber cuantas paginas caben al dia.
 *
 * Guarda las imagenes en `.data/cloudflare-spike/` para verlas.
 *
 * Termina con `process.exitCode` y no con `process.exit`: en Windows, salir de
 * golpe con `fetch` todavia cerrando conexiones aborta libuv.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sniffImage } from '../src/lib/images/sniff.ts';

const PROMPT =
  'Editorial photograph of hands shaping a ceramic bowl on a potter wheel, warm window light, muted earth palette, no text, no letters, no logos, no watermark';

async function main() {
  const account = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  const token = (process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
  const model = (process.env.CLOUDFLARE_IMAGE_MODEL ?? '').trim() || '@cf/black-forest-labs/flux-1-schnell';

  if (!account || !token) {
    console.log(`Faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN.

  1. Panel de Cloudflare -> Workers AI -> "Use REST API" -> "Create a Workers AI API Token"
     (permisos Workers AI Read y Edit) y copia tambien el Account ID.
  2. Anadelos a .env.local:
       CLOUDFLARE_ACCOUNT_ID=...
       CLOUDFLARE_API_TOKEN=...
  Guia: https://developers.cloudflare.com/workers-ai/get-started/rest-api/`);
    return 2;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`;
  const outDir = join(process.cwd(), '.data', 'cloudflare-spike');
  mkdirSync(outDir, { recursive: true });

  console.log(`Modelo: ${model}\nPrompt: ${PROMPT}\n`);

  let failures = 0;
  const rows = [];

  for (const steps of [1, 4]) {
    const started = Date.now();
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: PROMPT, steps }),
      });
    } catch (error) {
      failures += 1;
      console.log(`FAIL  steps=${steps}: sin respuesta (${error.message})`);
      continue;
    }
    const latencyMs = Date.now() - started;
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // no es JSON: se informa mas abajo
    }

    if (!response.ok || !body) {
      failures += 1;
      const errors = body?.errors ? JSON.stringify(body.errors) : text.slice(0, 300);
      console.log(`FAIL  steps=${steps}: HTTP ${response.status} en ${latencyMs} ms -> ${errors}`);
      if (response.status === 429) {
        console.log('      429: cuota diaria agotada (codigo 3036, o 4006 que es el que devuelve hoy la API) o capacidad temporal (3040).');
      }
      continue;
    }

    const base64 = body.result?.image ?? body.image;
    if (typeof base64 !== 'string') {
      failures += 1;
      console.log(`FAIL  steps=${steps}: la respuesta no trae imagen. Campos: ${Object.keys(body).join(', ')}`);
      continue;
    }

    const bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const info = sniffImage(bytes);
    if (!info) {
      failures += 1;
      console.log(`FAIL  steps=${steps}: los bytes no son PNG, JPEG ni WebP (${bytes.length} bytes)`);
      continue;
    }

    const extension = info.mime === 'image/jpeg' ? 'jpg' : info.mime.split('/')[1];
    const file = join(outDir, `flux-steps-${steps}.${extension}`);
    writeFileSync(file, bytes);

    // Segun la pagina de precios: 4,8 neuronas por tesela de 512x512 y 9,6 por paso.
    const tiles = info.width && info.height ? Math.ceil(info.width / 512) * Math.ceil(info.height / 512) : null;
    const neurons = tiles ? tiles * 4.8 + steps * 9.6 : null;
    rows.push({ steps, info, latencyMs, bytes: bytes.length, neurons });

    console.log(
      `PASS  steps=${steps}: ${info.mime} ${info.width ?? '?'}x${info.height ?? '?'}  ${(bytes.length / 1024).toFixed(0)} KB  ${latencyMs} ms` +
        `  envoltorio=[${Object.keys(body).join(', ')}]  -> ${file}`,
    );
  }

  if (rows.length > 0) {
    const four = rows.find((row) => row.steps === 4) ?? rows[0];
    console.log('\nResumen');
    console.log(`  Formato y resolucion de schnell: ${four.info.mime}, ${four.info.width ?? '?'}x${four.info.height ?? '?'}`);
    if (four.neurons) {
      const perDay = Math.floor(10_000 / four.neurons);
      console.log(
        `  Coste estimado a ${four.steps} pasos: ~${four.neurons.toFixed(1)} neuronas/imagen -> ~${perDay} imagenes al dia (~${Math.floor(perDay / 4)} paginas de 4 imagenes)`,
      );
      console.log('  Contrastalo con el panel de Cloudflare (Workers AI -> Usage): es una estimacion de la pagina de precios.');
    }
    console.log(`  Latencia a 4 pasos: ${four.latencyMs} ms (el paso de imagenes tiene un plazo de 45 s por defecto)`);
  }

  console.log(failures === 0 ? '\nTODO CORRECTO' : `\n${failures} comprobacion(es) fallida(s)`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
