import { searchParam, withContext } from '@/app/api/_lib/route-helpers';
import type { LandingStatus } from '@/types/domain';
import type { ProviderId } from '@/types/llm';

/** GET /api/landings - biblioteca del usuario, con filtros combinables. */
export async function GET(request: Request) {
  return withContext(async (ctx) =>
    ctx.store.listLandingPages(ctx.user.id, {
      search: searchParam(request, 'q'),
      projectId: searchParam(request, 'project'),
      technologyId: searchParam(request, 'technology'),
      status: searchParam(request, 'status') as LandingStatus | undefined,
      providerId: searchParam(request, 'provider') as ProviderId | undefined,
      category: searchParam(request, 'category'),
    }),
  );
}

export const dynamic = 'force-dynamic';
