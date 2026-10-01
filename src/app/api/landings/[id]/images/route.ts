import { withContext } from '@/app/api/_lib/route-helpers';
import { retryLandingImages } from '@/services/landing-generator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/landings/[id]/images - reintenta las imagenes que quedaron pendientes.
 *
 * Responde `{ landing, images, warnings, changed }`. Solo pide las que siguen
 * como marcador (las que ya tienen imagen no se tocan ni gastan cuota) y crea
 * una version nueva ("Imagenes") unicamente si se genero alguna. Sin cuerpo:
 * el HTML vigente lo dice todo.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => retryLandingImages({ ownerId: ctx.user.id, store: ctx.store }, id));
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
