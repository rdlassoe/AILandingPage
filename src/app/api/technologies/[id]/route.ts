import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { createTechnologySchema } from '@/lib/validation/schemas';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const input = await parseBody(request, createTechnologySchema.partial());
    return ctx.store.updateTechnology(ctx.user.id, id, input);
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    await ctx.store.deleteTechnology(ctx.user.id, id);
    return { deleted: id };
  });
}

export const dynamic = 'force-dynamic';
