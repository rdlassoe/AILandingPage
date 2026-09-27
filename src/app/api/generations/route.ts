import { parseBody, searchParam, withContext } from '@/app/api/_lib/route-helpers';
import { generateLanding } from '@/services/landing-generator';
import { generateLandingSchema } from '@/lib/validation/schemas';
import type { ProviderId } from '@/types/llm';

/** GET /api/generations - historial de generaciones (observabilidad). */
export async function GET(request: Request) {
  return withContext(async (ctx) =>
    ctx.store.listGenerations(ctx.user.id, {
      projectId: searchParam(request, 'project'),
      promptId: searchParam(request, 'prompt'),
      limit: 50,
    }),
  );
}

/** POST /api/generations - ejecuta el flujo completo de generacion. */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, generateLandingSchema);

    return generateLanding(
      { ownerId: ctx.user.id, store: ctx.store },
      {
        ownerId: ctx.user.id,
        projectId: input.projectId,
        promptContent: input.promptContent,
        systemInstruction: input.systemInstruction,
        promptId: input.promptId,
        providerId: input.providerId as ProviderId | undefined,
        model: input.model,
        config: input.config,
        label: input.label,
        allowCache: input.allowCache,
      },
    );
  });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
