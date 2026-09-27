import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { generateVariation } from '@/services/landing-generator';
import { variationSchema } from '@/lib/validation/schemas';
import type { ProviderId } from '@/types/llm';
import type { VariationStrategy } from '@/types/domain';

/** POST /api/generations/variation - crea una variante como Landing Page nueva. */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, variationSchema);

    return generateVariation(
      { ownerId: ctx.user.id, store: ctx.store },
      {
        ownerId: ctx.user.id,
        landingPageId: input.landingPageId,
        strategy: input.strategy as VariationStrategy,
        notes: input.notes,
        providerId: input.providerId as ProviderId | undefined,
        model: input.model,
      },
    );
  });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
