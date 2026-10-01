'use client';

import { useInlinedImages } from '@/lib/preview/use-inlined-images';

/**
 * Miniatura de una Landing Page que lleva imagenes generadas.
 *
 * El iframe (`sandbox=""`, origen opaco) no puede pedir `/api/landing-images/...`
 * por URL en desarrollo, asi que el navegador las descarga y se las entrega
 * incrustadas (ver `src/lib/preview/inline-images.ts`). Solo se usa para las
 * paginas que llevan imagenes: las demas siguen siendo un iframe renderizado en
 * el servidor, sin duplicar su HTML en la carga de la pagina.
 */
export function LandingThumbnail({ html, title }: { html: string; title: string }) {
  const srcDoc = useInlinedImages(html);
  // Mientras se descargan las imagenes el recuadro queda en blanco, como antes de cargar el iframe.
  if (srcDoc === null) return null;

  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      sandbox=""
      loading="lazy"
      aria-hidden="true"
      tabIndex={-1}
      className="pointer-events-none h-[1000px] w-[1280px] origin-top-left border-0"
      style={{ transform: 'scale(0.31)' }}
    />
  );
}
