import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { notFound } from '@/lib/errors';
import { updateProjectSchema } from '@/lib/validation/schemas';
import type { ProjectPatch } from '@/lib/data/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const project = await ctx.store.getProject(ctx.user.id, id);
    if (!project) throw notFound('ese proyecto');
    return project;
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const input = await parseBody(request, updateProjectSchema);
    // Solo se escriben las claves presentes: un PATCH nunca borra bloques enteros.
    const patch: ProjectPatch = {};
    if (input.basics) patch.basics = input.basics;
    if (input.visual) patch.visual = input.visual;
    if (input.technical) patch.technical = input.technical;
    if (input.content) patch.content = input.content;
    if (input.negativeConstraints) patch.negativeConstraints = input.negativeConstraints;
    if (input.status) patch.status = input.status;

    return ctx.store.updateProject(ctx.user.id, id, patch);
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    await ctx.store.deleteProject(ctx.user.id, id);
    return { deleted: id };
  });
}

export const dynamic = 'force-dynamic';
