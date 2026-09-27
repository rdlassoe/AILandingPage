import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { refineLanding } from '@/services/landing-generator';
import { refineSchema } from '@/lib/validation/schemas';
import type { ProviderId } from '@/types/llm';

/** POST /api/generations/refine - regenera aplicando las mejoras aceptadas. */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, refineSchema);

    return refineLanding(
      { ownerId: ctx.user.id, store: ctx.store },
      {
        ownerId: ctx.user.id,
        landingPageId: input.landingPageId,
        reviewId: input.reviewId,
        acceptedSuggestionIds: input.acceptedSuggestionIds,
        extraInstructions: input.extraInstructions,
        providerId: input.providerId as ProviderId | undefined,
        model: input.model,
      },
    );
  });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
