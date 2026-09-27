import { parseBody, searchParam, withContext } from '@/app/api/_lib/route-helpers';
import { critiqueLanding } from '@/services/critic-engine';
import { critiqueSchema } from '@/lib/validation/schemas';
import type { ProviderId } from '@/types/llm';

/** GET /api/generations/critique?landing=... - revisiones previas. */
export async function GET(request: Request) {
  return withContext(async (ctx) => {
    const landingPageId = searchParam(request, 'landing');
    if (!landingPageId) return [];
    return ctx.store.listReviews(ctx.user.id, landingPageId);
  });
}

/** POST /api/generations/critique - lanza el Critic Engine. */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, critiqueSchema);

    return critiqueLanding(
      { ownerId: ctx.user.id, store: ctx.store },
      {
        ownerId: ctx.user.id,
        landingPageId: input.landingPageId,
        providerId: input.providerId as ProviderId | undefined,
        model: input.model,
      },
    );
  });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
