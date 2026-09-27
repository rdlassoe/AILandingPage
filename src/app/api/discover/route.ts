import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { notFound } from '@/lib/errors';
import { discoverSchema } from '@/lib/validation/schemas';
import { buildDefineSpec, runDiscover } from '@/services/discover-engine';
import type { ProviderId } from '@/types/llm';

/**
 * POST /api/discover
 * Ejecuta la fase DISCOVER con el modelo y deriva la fase DEFINE de forma
 * determinista. Devuelve ambas para que el usuario pueda revisarlas.
 */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, discoverSchema);

    const discover = await runDiscover({ ownerId: ctx.user.id, store: ctx.store }, input.projectId, {
      providerId: input.providerId as ProviderId | undefined,
      model: input.model,
    });

    const project = await ctx.store.getProject(ctx.user.id, input.projectId);
    if (!project) throw notFound('ese proyecto');

    const define = buildDefineSpec(project);
    const updated = await ctx.store.updateProject(ctx.user.id, input.projectId, {
      define,
      status: project.status === 'draft' ? 'defined' : project.status,
    });

    return { discover, define, project: updated };
  });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
