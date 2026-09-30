import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { saveLandingHtmlSchema } from '@/lib/validation/schemas';
import { saveManualEdit } from '@/services/landing-generator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/landings/[id]/html - guarda el HTML editado a mano.
 *
 * Crea una version nueva ("Edicion manual") y la deja como la vigente. Responde
 * `{ landing, issues, changed }`: `issues` son los avisos no bloqueantes del
 * validador; los errores bloqueantes responden 422, y una version base distinta
 * de la vigente, 409.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const input = await parseBody(request, saveLandingHtmlSchema);
    return saveManualEdit({ ownerId: ctx.user.id, store: ctx.store }, id, input);
  });
}

export const dynamic = 'force-dynamic';
