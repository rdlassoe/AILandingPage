import { withContext } from '@/app/api/_lib/route-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/landings/[id]/versions - historial de versiones de la pagina. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => ctx.store.listLandingVersions(ctx.user.id, id));
}

export const dynamic = 'force-dynamic';
