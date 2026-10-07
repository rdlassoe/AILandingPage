import 'server-only';

import { env, envCredentials } from '@/lib/env';
import { postJson } from '@/lib/llm/http';
import { LLMError, type EffectiveCredentials } from '@/types/llm';
import { sniffImage, type ImageMime } from './sniff';

/**
 * Cliente de Cloudflare Workers AI para generar imagenes (FLUX.1 schnell).
 *
 *   POST {base}/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell
 *   { prompt (1-2048), steps (max. 8, por defecto 4) }
 *   -> { success, result: { image: <base64> }, errors, messages }
 *
 * Reutiliza el transporte de `postJson` (timeout, `AbortController`, traduccion
 * de errores HTTP) y aqui solo traduce a los codigos que entiende el paso de
 * imagenes. Es UN intento: los reintentos y la politica de cuota viven en
 * `src/services/image-generator`.
 *
 * Nada de lo que devuelve el proveedor se da por bueno: se decodifica el
 * base64, se comprueba por los primeros bytes que es PNG/JPEG/WebP y se acota
 * el tamano. La clave solo se lee aqui (`server-only`) y nunca se registra.
 */

export type ImageErrorCode =
  | 'not_configured'
  /** Cuota diaria de neuronas agotada (HTTP 429, codigo 3036 o 4006). */
  | 'quota'
  /** Capacidad temporal o limite de ritmo (HTTP 429, p. ej. 3040): vale reintentar. */
  | 'busy'
  | 'auth'
  | 'invalid_request'
  | 'timeout'
  | 'network'
  | 'server'
  /** La respuesta no es una imagen utilizable (base64 roto, formato raro, demasiado grande). */
  | 'invalid_image'
  | 'cancelled'
  | 'unknown';

const RETRYABLE: ReadonlySet<ImageErrorCode> = new Set(['busy', 'timeout', 'network', 'server']);

export class ImageGenerationError extends Error {
  readonly code: ImageErrorCode;
  readonly status?: number;
  /** Codigo numerico de Cloudflare (`errors[0].code`), si lo hubo. */
  readonly providerCode?: number;
  readonly retryable: boolean;

  constructor(params: { code: ImageErrorCode; message: string; status?: number; providerCode?: number; cause?: unknown }) {
    super(params.message, { cause: params.cause });
    this.name = 'ImageGenerationError';
    this.code = params.code;
    this.status = params.status;
    this.providerCode = params.providerCode;
    this.retryable = RETRYABLE.has(params.code);
  }
}

export interface GeneratedImage {
  bytes: Buffer;
  mime: ImageMime;
  /** Dimensiones leidas de la propia imagen; `null` si no se pudieron leer. */
  width: number | null;
  height: number | null;
  latencyMs: number;
  model: string;
}

/** Lo unico que necesita Cloudflare de las credenciales del usuario. */
export type ImageCredentials = Pick<EffectiveCredentials, 'cloudflareAccountId' | 'cloudflareApiToken'>;

export interface GenerateImageRequest {
  /** Credenciales del usuario; sin ellas, las del entorno. */
  credentials?: ImageCredentials;
  prompt: string;
  steps?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface CloudflareRunResponse {
  success?: boolean;
  result?: { image?: string } | null;
  image?: string;
  errors?: Array<{ code?: number; message?: string }>;
}

/** Codigos de "cuota diaria agotada": 3036 es el documentado, 4006 el que devuelve hoy la API. */
const QUOTA_CODES: ReadonlySet<number> = new Set([3036, 4006]);
/** "Capacidad temporal": el propio Cloudflare pide reintentar. */
const BUSY_CODES: ReadonlySet<number> = new Set([3040]);

/** Cuenta y token, los dos: con solo uno no se puede llamar a la API. */
export function isImageGenerationConfigured(credentials: ImageCredentials = envCredentials()): boolean {
  return credentials.cloudflareAccountId.length > 0 && credentials.cloudflareApiToken.length > 0;
}

export async function generateImage(request: GenerateImageRequest): Promise<GeneratedImage> {
  const credentials = request.credentials ?? envCredentials();
  if (!isImageGenerationConfigured(credentials)) {
    throw new ImageGenerationError({
      code: 'not_configured',
      message: 'Faltan el Account ID o el token de Cloudflare.',
    });
  }

  const prompt = request.prompt.trim().slice(0, 2048);
  if (prompt.length === 0) {
    throw new ImageGenerationError({ code: 'invalid_request', message: 'El prompt de la imagen esta vacio.' });
  }

  const { baseUrl, model } = env.cloudflare;
  const { cloudflareAccountId: accountId, cloudflareApiToken: apiToken } = credentials;
  const started = Date.now();

  let data: CloudflareRunResponse;
  try {
    data = await postJson<CloudflareRunResponse>({
      provider: 'cloudflare',
      url: `${baseUrl}/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
      headers: { authorization: `Bearer ${apiToken}` },
      body: { prompt, steps: Math.min(8, Math.max(1, request.steps ?? env.images.steps)) },
      timeoutMs: request.timeoutMs ?? env.images.timeoutMs,
      signal: request.signal,
    });
  } catch (error) {
    throw translateTransportError(error);
  }

  const base64 = data.result?.image ?? data.image;
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw envelopeError(data);
  }

  return {
    ...decodeImage(base64),
    latencyMs: Date.now() - started,
    model,
  };
}

/** Decodifica y valida lo que devolvio el proveedor. Exportada para las pruebas. */
export function decodeImage(base64: string): Pick<GeneratedImage, 'bytes' | 'mime' | 'width' | 'height'> {
  // El limite se comprueba ANTES de decodificar: un base64 enorme no debe llegar a un Buffer.
  const payload = base64.replace(/^data:[^;]+;base64,/, '');
  if (payload.length > Math.ceil((env.images.maxBytes * 4) / 3) + 8) {
    throw new ImageGenerationError({
      code: 'invalid_image',
      message: `La imagen supera el tope de ${Math.round(env.images.maxBytes / 1024 / 1024)} MB.`,
    });
  }

  const bytes = Buffer.from(payload, 'base64');
  const sniffed = sniffImage(bytes);
  if (bytes.length < 64 || !sniffed) {
    throw new ImageGenerationError({
      code: 'invalid_image',
      message: 'La respuesta del proveedor no es una imagen PNG, JPEG o WebP.',
    });
  }
  return { bytes, mime: sniffed.mime, width: sniffed.width, height: sniffed.height };
}

function translateTransportError(error: unknown): ImageGenerationError {
  if (error instanceof ImageGenerationError) return error;

  if (error instanceof LLMError) {
    const providerCode = extractProviderCode(error.message);
    const detail = error.message.slice(0, 300);

    if (error.status === 429) {
      const quota =
        (providerCode !== undefined && QUOTA_CODES.has(providerCode)) || /daily free allocation/i.test(error.message);
      return new ImageGenerationError({
        code: quota ? 'quota' : 'busy',
        message: quota ? 'Cuota diaria de Cloudflare Workers AI agotada.' : 'Cloudflare Workers AI esta saturado.',
        status: 429,
        providerCode,
        cause: error,
      });
    }

    const code: ImageErrorCode =
      error.code === 'auth'
        ? 'auth'
        : error.code === 'timeout'
          ? 'timeout'
          : error.code === 'network'
            ? 'network'
            : error.code === 'server'
              ? 'server'
              : error.code === 'cancelled'
                ? 'cancelled'
                : error.code === 'invalid_response' || error.code === 'too_large'
                  ? 'invalid_request'
                  : 'unknown';
    return new ImageGenerationError({ code, message: detail, status: error.status, providerCode, cause: error });
  }

  return new ImageGenerationError({
    code: 'unknown',
    message: error instanceof Error ? error.message : 'Error desconocido al generar la imagen.',
    cause: error,
  });
}

/** Respuesta 200 sin imagen: Cloudflare puede devolver `success: false` con `errors`. */
function envelopeError(data: CloudflareRunResponse): ImageGenerationError {
  const first = data.errors?.[0];
  const providerCode = typeof first?.code === 'number' ? first.code : undefined;
  const message = first?.message?.slice(0, 300) ?? 'La respuesta de Cloudflare no trae ninguna imagen.';

  if (providerCode !== undefined && QUOTA_CODES.has(providerCode)) {
    return new ImageGenerationError({ code: 'quota', message, providerCode });
  }
  if (providerCode !== undefined && BUSY_CODES.has(providerCode)) {
    return new ImageGenerationError({ code: 'busy', message, providerCode });
  }
  return new ImageGenerationError({ code: 'invalid_image', message, providerCode });
}

/** `postJson` mete el cuerpo del error en el mensaje: de ahi se saca el codigo de Cloudflare. */
function extractProviderCode(message: string): number | undefined {
  const match = /"code"\s*:\s*(\d{4})/.exec(message);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

export interface ImageConnectionHealth {
  ok: boolean;
  message: string;
  latencyMs: number;
  model: string;
  mime?: ImageMime;
  bytes?: number;
  width?: number | null;
  height?: number | null;
}

/**
 * Prueba de conexion de Ajustes: una imagen real con UN paso de difusion, que
 * es lo mas barato que admite la API. Gasta algunas decenas de neuronas de la
 * cuota diaria; no hay una llamada "gratis" de comprobacion.
 */
export async function testImageConnection(credentials?: ImageCredentials): Promise<ImageConnectionHealth> {
  const started = Date.now();
  try {
    const image = await generateImage({
      credentials,
      prompt: 'a plain white square on a light grey background',
      steps: 1,
    });
    return {
      ok: true,
      message: `Imagen de ${image.width ?? '?'}x${image.height ?? '?'} (${image.mime}) en ${image.latencyMs} ms.`,
      latencyMs: image.latencyMs,
      model: image.model,
      mime: image.mime,
      bytes: image.bytes.length,
      width: image.width,
      height: image.height,
    };
  } catch (error) {
    const failure = error instanceof ImageGenerationError ? error : null;
    return {
      ok: false,
      message: describeImageError(failure?.code ?? 'unknown'),
      latencyMs: Date.now() - started,
      model: env.cloudflare.model,
    };
  }
}

/** Mensaje para el usuario; nunca incluye el detalle tecnico ni la clave. */
export function describeImageError(code: ImageErrorCode): string {
  switch (code) {
    case 'not_configured':
      return 'Cloudflare no esta configurado: faltan el Account ID o el token (pegalos en Ajustes o define CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN en el servidor).';
    case 'quota':
      return 'Cuota gratuita de Cloudflare Workers AI agotada. Vuelve a intentarlo mas tarde.';
    case 'busy':
      return 'Cloudflare Workers AI esta saturado ahora mismo.';
    case 'auth':
      return 'Cloudflare rechazo las credenciales: revisa el token (permisos Workers AI Read y Edit) y el Account ID.';
    case 'invalid_request':
      return 'Cloudflare rechazo la peticion (prompt o modelo no validos).';
    case 'timeout':
      return 'Cloudflare tardo demasiado en generar la imagen.';
    case 'network':
      return 'No se pudo contactar con Cloudflare.';
    case 'server':
      return 'Cloudflare devolvio un error interno.';
    case 'invalid_image':
      return 'Cloudflare devolvio algo que no es una imagen utilizable.';
    case 'cancelled':
      return 'La generacion de la imagen se cancelo.';
    default:
      return 'Error desconocido al generar la imagen.';
  }
}
