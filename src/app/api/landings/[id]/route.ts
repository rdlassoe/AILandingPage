import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { notFound } from '@/lib/errors';
import { updateLandingSchema } from '@/lib/validation/schemas';
import type { LandingPagePatch } from '@/lib/data/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const landing = await ctx.store.getLandingPage(ctx.user.id, id);
    if (!landing) throw notFound('esa Landing Page');
    return landing;
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const input = await parseBody(request, updateLandingSchema);
    const landing = await ctx.store.getLandingPage(ctx.user.id, id);
    if (!landing) throw notFound('esa Landing Page');

    const patch: LandingPagePatch = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.category !== undefined) patch.category = input.category;

    // El HTML no se edita por aqui: ver `PUT /api/landings/[id]/html`.
    return ctx.store.updateLandingPage(ctx.user.id, id, patch);
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    await ctx.store.deleteLandingPage(ctx.user.id, id);
    return { deleted: id };
  });
}

export const dynamic = 'force-dynamic';
