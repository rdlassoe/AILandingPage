import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { createSeedSchema } from '@/lib/validation/schemas';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const input = await parseBody(request, createSeedSchema.partial());
    return ctx.store.updateSeed(ctx.user.id, id, input);
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withContext(async (ctx) => {
    await ctx.store.deleteSeed(ctx.user.id, id);
    return { deleted: id };
  });
}

export const dynamic = 'force-dynamic';
