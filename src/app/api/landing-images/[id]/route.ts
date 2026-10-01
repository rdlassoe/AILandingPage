import { NextResponse } from 'next/server';

import { readLocalImage } from '@/lib/data/local-store';
import { env } from '@/lib/env';
import { IMAGES_BUCKET } from '@/lib/images/constants';
import { isImageId } from '@/lib/images/slots';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/landing-images/[id] - imagen generada con IA, SIN sesion.
 *
 * Es la URL que el HTML guardado lleva en `<img src>`. No pide cookies a
 * proposito: la vista previa corre en un iframe `sandbox` sin
 * `allow-same-origin` (origen opaco), que no envia las cookies de sesion, y la
 * biblioteca pinta otro iframe sin ningun permiso por cada tarjeta. La
 * capacidad de lectura es el propio `id`: un uuid v4, imposible de adivinar.
 * Consecuencia asumida: quien tenga la URL exacta ve esa imagen aunque la
 * Landing Page sea privada (ver docs/ARCHITECTURE.md, decision 12).
 *
 * Primero se busca en el almacen local y despues, si Supabase esta activo, se
 * redirige al bucket publico: sin consulta a BD ni clave de servicio, y el
 * HTML no cambia si las imagenes se mueven de un modo al otro.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  // Es lo unico que separa un id de una ruta de fichero: va antes de tocar nada.
  if (!isImageId(id)) return notFound();

  const local = await readLocalImage(id);
  if (local) {
    return new NextResponse(new Uint8Array(local.data), {
      status: 200,
      headers: {
        'Content-Type': local.mime,
        'Content-Length': String(local.data.byteLength),
        // Una imagen no cambia nunca: se genera otra con otro id.
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        // Defensa en profundidad: aunque algun dia se sirviera algo activo, no se ejecutaria.
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  }

  if (env.supabase.enabled) {
    const publicUrl = `${env.supabase.url}/storage/v1/object/public/${IMAGES_BUCKET}/${id.toLowerCase()}`;
    return NextResponse.redirect(publicUrl, {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  }

  return notFound();
}

function notFound() {
  return new NextResponse('Imagen no encontrada', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const dynamic = 'force-dynamic';
