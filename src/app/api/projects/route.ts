import { parseBody, searchParam, withContext } from '@/app/api/_lib/route-helpers';
import { DEFAULT_NEGATIVE_CONSTRAINTS } from '@/lib/data/catalog';
import { createProjectSchema } from '@/lib/validation/schemas';
import type { ProjectStatus } from '@/types/domain';

/** GET /api/projects - lista los proyectos del usuario. */
export async function GET(request: Request) {
  return withContext(async (ctx) =>
    ctx.store.listProjects(ctx.user.id, {
      search: searchParam(request, 'q'),
      status: searchParam(request, 'status') as ProjectStatus | undefined,
      technologyId: searchParam(request, 'technology'),
    }),
  );
}

/** POST /api/projects - crea un proyecto. */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, createProjectSchema);

    return ctx.store.createProject(ctx.user.id, {
      status: 'draft',
      basics: input.basics,
      visual: input.visual,
      technical: input.technical,
      content: input.content,
      negativeConstraints:
        input.negativeConstraints.length > 0 ? input.negativeConstraints : DEFAULT_NEGATIVE_CONSTRAINTS,
      discover: null,
      define: null,
    });
  });
}

export const dynamic = 'force-dynamic';
