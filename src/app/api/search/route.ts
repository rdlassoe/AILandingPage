import { searchParam, withContext } from '@/app/api/_lib/route-helpers';

/** GET /api/search?q= - busqueda global del workspace. */
export async function GET(request: Request) {
  return withContext(async (ctx) => {
    const query = searchParam(request, 'q');
    if (!query || query.length < 2) {
      return { projects: [], prompts: [], landingPages: [], technologies: [], seeds: [] };
    }
    return ctx.store.search(ctx.user.id, query);
  });
}

export const dynamic = 'force-dynamic';
