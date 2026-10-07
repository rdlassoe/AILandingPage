import { withContext } from '@/app/api/_lib/route-helpers';
import { resolveCredentials } from '@/lib/credentials';
import { testImageConnection } from '@/lib/images/cloudflare';

/**
 * POST /api/providers/image/test
 * Prueba de conexion real contra Cloudflare Workers AI: genera UNA imagen de un
 * solo paso de difusion, lo mas barato que admite la API (unas pocas decenas de
 * neuronas de la cuota diaria). Nunca devuelve el token ni el detalle tecnico.
 */
export async function POST() {
  return withContext(async (ctx) => testImageConnection(await resolveCredentials(ctx.store, ctx.user.id)));
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
