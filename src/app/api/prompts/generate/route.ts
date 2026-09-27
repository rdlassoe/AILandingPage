import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { notFound } from '@/lib/errors';
import { buildPromptSchema } from '@/lib/validation/schemas';
import { buildLandingPrompt, DEFAULT_TECHNIQUE_IDS } from '@/services/prompt-engine';
import type { DesignTechniqueId } from '@/types/services';

/**
 * POST /api/prompts/generate
 * Compone el prompt sin ejecutarlo. Permite revisarlo y editarlo antes de
 * gastar cuota de ningun proveedor.
 */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, buildPromptSchema);

    const project = await ctx.store.getProject(ctx.user.id, input.projectId);
    if (!project) throw notFound('ese proyecto');

    const technologyIds = input.technologyIds ?? project.technical.technologyIds;
    const technologies = await ctx.store.getTechnologiesByIds(technologyIds);
    const seed = project.seedStringId ? await ctx.store.getSeed(project.seedStringId) : null;

    return buildLandingPrompt({
      project,
      technologies,
      seed,
      customSeedValue: input.customSeedValue ?? project.seedStringValue,
      negativeConstraints: input.negativeConstraints ?? project.negativeConstraints,
      designTechniques: (input.designTechniques as DesignTechniqueId[] | undefined) ?? DEFAULT_TECHNIQUE_IDS,
      discover: project.discover,
      define: project.define,
    });
  });
}

export const dynamic = 'force-dynamic';
