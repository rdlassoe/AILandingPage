'use client';

import { useEffect, useMemo, useState } from 'react';

import { allImagesCached, hasImageUrls, inlineCachedImages, inlineLandingImages } from './inline-images';

/**
 * Documento listo para el `srcDoc` de un iframe sandbox: el mismo HTML pero con
 * las imagenes generadas incrustadas como `data:` (ver `inline-images.ts`: desde
 * un origen opaco no se pueden pedir por URL a `localhost`).
 *
 *   - Sin imagenes, o con todas ya en la cache: es sincrono, igual que antes.
 *   - Con alguna por descargar: devuelve `null` hasta tenerlas, para que el iframe
 *     no cargue primero el documento con imagenes rotas y se recargue despues.
 *
 * Se aplica al documento YA instrumentado por el inspector: las posiciones de
 * `data-ale-src` son numeros calculados sobre el texto original, asi que no les
 * afecta sustituir una URL por un `data:` dentro del `srcDoc`.
 */
export function useInlinedImages(html: string | null): string | null {
  const [downloaded, setDownloaded] = useState<{ source: string; result: string } | null>(null);

  // Se recalcula en cada render (es una busqueda, no una descarga) y pasa a `false` en
  // cuanto la cache se llena: de ahi depende todo lo demas.
  const pending = html !== null && hasImageUrls(html) && !allImagesCached(html);

  // Con todo en cache la sustitucion es sincrona. NO depende solo de `html`: la cache se
  // llena despues de la primera pasada, y eso es justo lo que `pending` marca.
  const inlined = useMemo(() => (html === null || pending ? null : inlineCachedImages(html)), [html, pending]);

  useEffect(() => {
    if (html === null || !pending) return;
    let cancelled = false;
    inlineLandingImages(html).then(({ html: result }) => {
      if (!cancelled) setDownloaded({ source: html, result });
    });
    return () => {
      cancelled = true;
    };
  }, [html, pending]);

  if (html === null) return null;
  if (!pending) return inlined;
  // Hay algo por descargar: si alguna imagen fallo (no entra en la cache), `pending` no se
  // apaga nunca y se usa el resultado con las URL absolutas de respaldo.
  if (downloaded?.source === html) return downloaded.result;
  // La primera vez no se pinta nada hasta tener las imagenes; en las siguientes (el editor
  // cambia el HTML) se enseña lo que ya hay para que la vista previa no parpadee en blanco.
  return downloaded === null ? null : inlineCachedImages(html);
}
