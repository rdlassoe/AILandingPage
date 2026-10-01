import 'server-only';

import type { DataStore } from '@/lib/data/types';
import { env } from '@/lib/env';
import { AppException } from '@/lib/errors';
import {
  describeImageError,
  generateImage,
  ImageGenerationError,
  isImageGenerationConfigured,
  type ImageErrorCode,
} from '@/lib/images/cloudflare';
import {
  grantImageBudget,
  quotaBreakerRemainingMs,
  storageBreaker,
  tripQuotaBreaker,
  tripStorageBreaker,
} from '@/lib/images/limits';
import { applySlotResults, findImageSlots, IMAGE_ATTR, type ImageSlot, type SlotResult } from '@/lib/images/slots';
import type { ImageStepReport } from '@/types/services';

/**
 * Image Generator
 *
 * Con la tecnica "Generacion de imagenes" el LLM deja marcadores
 * `<img data-ai-image="prompt en ingles" alt="...">` sin `src`. Este servicio
 * los convierte en imagenes reales con FLUX (Cloudflare Workers AI) DESPUES de
 * validar la salida y ANTES de guardarla, y deja el HTML con URLs cortas
 * (`/api/landing-images/<uuid>`): los bytes nunca viajan dentro del HTML.
 *
 * No es fatal. Si no hay credenciales, se agoto la cuota, vencio el plazo o una
 * imagen fallo, la pagina se guarda igualmente con un bloque neutro y un
 * comentario con el prompt en ese sitio, y el informe dice cuantas faltan para
 * que la interfaz ofrezca reintentar solo las pendientes. Nunca se fabrica una
 * imagen falsa: sin imagen real, hay un marcador visible como tal.
 *
 * El propio HTML es el estado (un marcador esta pendiente si su `src` no apunta
 * a `/api/landing-images/`), asi que reintentar es volver a llamar a
 * `finalizeLandingImages` sobre el HTML vigente.
 */

/** Por debajo de esto no merece la pena empezar: no daria tiempo a una imagen. */
const MIN_STEP_MS = 10_000;
/** Imagenes en vuelo a la vez. Cloudflare admite 720/min: el limite real es el plazo. */
const CONCURRENCY = 2;

/** schnell no tiene prompt negativo: se pide por escrito que no haya texto ni marcas. */
const PROMPT_SUFFIX = ', no text, no letters, no logos, no watermark';

const NO_SLOTS_WARNING =
  'La tecnica de imagenes estaba activa, pero el modelo no dejo ningun marcador <img data-ai-image>: la pagina no lleva imagenes generadas.';

type FailureKey = ImageErrorCode | 'budget' | 'deadline' | 'over_cap' | 'storage';

export interface FinalizeImagesInput {
  html: string;
  ownerId: string;
  store: DataStore;
  projectId: string;
  generationId: string | null;
  /** El prompt pedia imagenes (la marca de la tecnica estaba en el), aunque la salida no traiga marcadores. */
  promptRequestedImages: boolean;
  /** Instante absoluto (ms desde epoch) hasta el que puede durar este paso. */
  deadlineAt: number;
  signal?: AbortSignal;
  /** Solo para las pruebas: espera entre el intento y su reintento. */
  retryDelayMs?: number;
}

export interface FinalizeImagesResult {
  /** HTML con los marcadores resueltos (o con el bloque neutro donde no se pudo). */
  html: string;
  /** Avisos para el usuario; acaban en `validation.issues` y en `generations.warnings`. */
  warnings: string[];
  report: ImageStepReport;
}

export async function finalizeLandingImages(input: FinalizeImagesInput): Promise<FinalizeImagesResult> {
  try {
    return await run(input);
  } catch (error) {
    // El paso de imagenes jamas debe tumbar una generacion que ya salio bien.
    if (process.env.NODE_ENV !== 'production') console.error('[image-generator]', error);
    return {
      html: input.html,
      warnings: ['No se pudieron generar las imagenes por un error inesperado; la pagina se guardo con los marcadores.'],
      report: { total: 0, ready: 0, generated: 0, pending: 0, reason: 'Error inesperado.' },
    };
  }
}

async function run(input: FinalizeImagesInput): Promise<FinalizeImagesResult> {
  const scan = await findImageSlots(input.html);
  const total = scan.slots.length;

  if (total === 0) {
    return {
      html: input.html,
      warnings: input.promptRequestedImages ? [NO_SLOTS_WARNING] : [],
      report: { total: 0, ready: 0, generated: 0, pending: 0, reason: input.promptRequestedImages ? 'El modelo no dejo marcadores.' : null },
    };
  }

  const pendingSlots = scan.slots.filter((slot) => slot.state === 'pending');
  const alreadyReady = total - pendingSlots.length;
  if (pendingSlots.length === 0) {
    return { html: input.html, warnings: [], report: { total, ready: total, generated: 0, pending: 0, reason: null } };
  }

  const results = new Map<number, SlotResult>();
  const failures = new Map<FailureKey, number>();
  const fail = (slot: ImageSlot, key: FailureKey) => {
    results.set(slot.index, { kind: 'pending' });
    failures.set(key, (failures.get(key) ?? 0) + 1);
  };
  let generated = 0;

  // 1. Cuales se intentan y cuales ni siquiera se piden.
  let queue = pendingSlots.slice(0, env.images.maxPerLanding);
  for (const slot of pendingSlots.slice(queue.length)) fail(slot, 'over_cap');

  if (queue.length > 0) {
    const blocked = gate(input);
    if (blocked) {
      for (const slot of queue) fail(slot, blocked);
      queue = [];
    }
  }
  if (queue.length > 0) {
    const granted = grantImageBudget(input.ownerId, queue.length, { perHour: env.images.ratePerHour });
    for (const slot of queue.slice(granted)) fail(slot, 'budget');
    queue = queue.slice(0, granted);
  }

  // 2. Generacion, con `CONCURRENCY` imagenes en vuelo.
  const waiting = [...queue];
  const worker = async () => {
    for (let slot = waiting.shift(); slot; slot = waiting.shift()) {
      const outcome = await generateOne(slot, input);
      if (outcome.kind === 'ready') {
        results.set(slot.index, { kind: 'ready', imageId: outcome.imageId });
        generated += 1;
      } else {
        fail(slot, outcome.key);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  // 3. Se empalma el resultado de TODOS los pendientes: los que fallaron reciben el bloque neutro.
  const html = applySlotResults(
    scan.source,
    pendingSlots.map((slot) => ({ slot, result: results.get(slot.index) ?? { kind: 'pending' as const } })),
  );

  const pending = pendingSlots.length - generated;
  const warnings = [...failures].map(([key, count]) => {
    return `${count} ${count === 1 ? 'imagen sin generar' : 'imagenes sin generar'}: ${describeFailure(key)}`;
  });
  const firstFailure = [...failures.keys()][0];

  return {
    html,
    warnings,
    report: {
      total,
      ready: alreadyReady + generated,
      generated,
      pending,
      reason: pending > 0 && firstFailure ? describeFailure(firstFailure) : null,
    },
  };
}

/** Motivo por el que no se debe llamar a Cloudflare ahora mismo, o `null` si se puede. */
function gate(input: FinalizeImagesInput): FailureKey | null {
  if (!isImageGenerationConfigured()) return 'not_configured';
  if (quotaBreakerRemainingMs() > 0) return 'quota';
  // La ultima imagen no se pudo guardar: generar otra solo gastaria neuronas.
  if (storageBreaker().remainingMs > 0) return 'storage';
  if (input.deadlineAt - Date.now() < MIN_STEP_MS) return 'deadline';
  return null;
}

type Outcome = { kind: 'ready'; imageId: string } | { kind: 'failed'; key: FailureKey };

/** Una imagen: un intento y, solo si el fallo es transitorio y queda tiempo, un reintento. */
async function generateOne(slot: ImageSlot, input: FinalizeImagesInput): Promise<Outcome> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // Otro marcador pudo agotar la cuota (o descubrir que no se puede guardar) mientras este
    // esperaba su turno: seguir solo gastaria neuronas.
    if (quotaBreakerRemainingMs() > 0) return { kind: 'failed', key: 'quota' };
    if (storageBreaker().remainingMs > 0) return { kind: 'failed', key: 'storage' };

    const remaining = input.deadlineAt - Date.now();
    if (remaining < 2_000) return { kind: 'failed', key: 'deadline' };

    let image;
    try {
      image = await generateImage({
        prompt: buildFluxPrompt(slot.prompt),
        signal: input.signal,
        timeoutMs: Math.min(env.images.timeoutMs, remaining),
      });
    } catch (error) {
      const code: ImageErrorCode = error instanceof ImageGenerationError ? error.code : 'unknown';
      if (code === 'quota') tripQuotaBreaker(env.images.quotaCooldownMs);

      const retryable = error instanceof ImageGenerationError && error.retryable;
      if (retryable && attempt === 1) {
        await sleep(input.retryDelayMs ?? retryDelay(code), input.signal);
        continue;
      }
      return { kind: 'failed', key: code };
    }

    try {
      const saved = await input.store.saveLandingImage(input.ownerId, {
        projectId: input.projectId,
        generationId: input.generationId,
        prompt: slot.prompt,
        alt: slot.alt,
        mime: image.mime,
        width: image.width,
        height: image.height,
        model: image.model,
        latencyMs: image.latencyMs,
        data: image.bytes,
      });
      return { kind: 'ready', imageId: saved.id };
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.error('[image-generator] no se pudo guardar la imagen', error);
      // Regenerarla no arregla un fallo del almacen, y las siguientes tampoco se podrian guardar.
      tripStorageBreaker(env.images.storageCooldownMs, describeStorageError(error));
      return { kind: 'failed', key: 'storage' };
    }
  }
  return { kind: 'failed', key: 'unknown' };
}

/**
 * Prompt final para FLUX: el del LLM, saneado y con el sufijo que prohibe
 * texto y marcas. Cloudflare acepta hasta 2048 caracteres; el LLM tiene
 * instruccion de no pasar de 300, asi que 1000 es un techo holgado.
 */
export function buildFluxPrompt(prompt: string): string {
  const clean = prompt
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000)
    .replace(/[,.;\s]+$/, '');
  return `${clean}${PROMPT_SUFFIX}`;
}

/**
 * Causa probable de un fallo al guardar, para decirselo al usuario en vez de un
 * generico "no se pudo guardar". El caso tipico es Supabase sin el esquema de las
 * imagenes (la tabla y el bucket los crea `npm run db:setup`): sin esta pista la
 * imagen se genera, se gasta la cuota y la pagina solo muestra el marcador.
 */
export function describeStorageError(error: unknown): string | null {
  const text =
    error instanceof AppException
      ? `${error.message} ${error.detail ?? ''}`
      : error instanceof Error
        ? error.message
        : String(error ?? '');

  if (/bucket/i.test(text) && /not found|does not exist|no existe/i.test(text)) {
    return 'falta el bucket publico `landing-images` de Supabase Storage (ejecuta `npm run db:setup` o crealo en el panel de Supabase)';
  }
  if (/landing_images|42P01|PGRST205|schema cache|relation .* does not exist/i.test(text)) {
    return 'falta la tabla `landing_images` en Supabase (ejecuta `npm run db:setup`)';
  }
  if (/row-level security|violates|unauthorized|forbidden|403|permission denied/i.test(text)) {
    return 'Supabase rechazo la escritura: revisa las politicas de `landing_images` y de `storage.objects` (`npm run db:setup` las crea)';
  }
  return null;
}

function retryDelay(code: ImageErrorCode): number {
  // Un modelo saturado no se recupera en un segundo (mismo criterio que el orquestador de texto).
  if (code === 'busy') return 2_500;
  if (code === 'server') return 3_000;
  return 1_000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function describeFailure(key: FailureKey): string {
  switch (key) {
    case 'budget':
      return `limite de ${env.images.ratePerHour} imagenes por hora alcanzado.`;
    case 'deadline':
      return 'no quedaba tiempo en esta peticion. Usa "Reintentar imagenes".';
    case 'over_cap':
      return `solo se generan ${env.images.maxPerLanding} imagenes por pagina.`;
    case 'storage': {
      const { hint } = storageBreaker();
      return `no se pudo guardar la imagen generada${hint ? `: ${hint}` : '.'}`;
    }
    default:
      return describeImageError(key);
  }
}

/** Para las pruebas y para comprobar que el prompt pedia imagenes. */
export const IMAGE_MARKER = IMAGE_ATTR;
