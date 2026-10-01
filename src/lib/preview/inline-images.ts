import { IMAGE_ROUTE_PREFIX, IMAGE_URL_PATTERN, isImageId } from '@/lib/images/slots';

/**
 * Incrusta las imagenes generadas en el HTML como `data:` URIs, SOLO al mostrar
 * o exportar.
 *
 * El HTML guardado lleva `/api/landing-images/<uuid>`: corto, sin bytes, y
 * valido para el resto de la aplicacion (editor, critico, refinamiento). Pero
 * hay dos sitios donde esa URL no sirve tal cual:
 *
 *   1. El iframe de la vista previa (`sandbox` SIN `allow-same-origin`, origen
 *      opaco). Se comprobo en un navegador real: desde un origen opaco las
 *      peticiones a `localhost` se bloquean por completo (ni un `fetch` con
 *      `no-cors` sale), aunque las imagenes externas y los `data:` cargan bien.
 *      En un despliegue con dominio publico funcionaria, pero en desarrollo
 *      —donde se ejecuta esta aplicacion— la vista previa mostraria imagenes
 *      rotas. Por eso el PADRE las descarga (mismo origen, sin restricciones) y
 *      le entrega al iframe un documento con `data:` URIs. Conceder
 *      `allow-same-origin` para evitarlo dejaria que el HTML generado
 *      (codigo no confiable) se quitara el sandbox: decision 6.
 *   2. Un fichero descargado, el HTML copiado al portapapeles o una pestana
 *      `blob:` no pueden resolver una URL relativa.
 *
 * Las imagenes descargadas se guardan en una cache de modulo: el editor
 * reconstruye el documento cada pocos cientos de milisegundos y no debe volver
 * a pedir ni a codificar lo que ya tiene.
 *
 * Si una imagen no se puede descargar, su URL se deja pero ABSOLUTA (con el
 * origen de la aplicacion): mientras esta siga en marcha, al menos se ve fuera
 * de un sandbox.
 */

const URL_REGEX = new RegExp(IMAGE_URL_PATTERN, 'gi');

/** id -> `data:` URI. Las imagenes no cambian nunca (otro id = otra imagen), asi que no caduca. */
const cache = new Map<string, string>();

export interface InlineImagesResult {
  html: string;
  inlined: number;
  failed: number;
}

export function hasImageUrls(html: string): boolean {
  return html.includes(IMAGE_ROUTE_PREFIX);
}

/** Ids de imagen distintos que aparecen en el HTML, en minusculas. */
function imageIds(html: string): string[] {
  return [...new Set([...html.matchAll(URL_REGEX)].map((match) => (match[1] ?? '').toLowerCase()))].filter(isImageId);
}

/** Sustituye solo las imagenes que ya estan en la cache: sincrono, sin red. */
export function inlineCachedImages(html: string): string {
  if (!hasImageUrls(html)) return html;
  return html.replace(URL_REGEX, (whole, id: string) => cache.get(id.toLowerCase()) ?? whole);
}

/** `true` si todas las imagenes del HTML estan ya en la cache (o no hay ninguna). */
export function allImagesCached(html: string): boolean {
  return imageIds(html).every((id) => cache.has(id));
}

export async function inlineLandingImages(html: string): Promise<InlineImagesResult> {
  if (!hasImageUrls(html)) return { html, inlined: 0, failed: 0 };

  const ids = imageIds(html);
  const fallbacks = new Map<string, string>();
  let failed = 0;

  await Promise.all(
    ids
      .filter((id) => !cache.has(id))
      .map(async (id) => {
        const path = `${IMAGE_ROUTE_PREFIX}${id}`;
        try {
          const response = await fetch(path, { cache: 'force-cache' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          cache.set(id, await toDataUri(await response.blob()));
        } catch {
          failed += 1;
          fallbacks.set(id, `${window.location.origin}${path}`);
        }
      }),
  );

  const out = html.replace(URL_REGEX, (whole, id: string) => {
    const key = id.toLowerCase();
    return cache.get(key) ?? fallbacks.get(key) ?? whole;
  });
  return { html: out, inlined: ids.length - failed, failed };
}

function toDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(blob);
  });
}
