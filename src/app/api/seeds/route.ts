import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { createSeedSchema } from '@/lib/validation/schemas';

/** GET /api/seeds - Seed Strings predefinidas y propias. */
export async function GET() {
  return withContext(async (ctx) => ctx.store.listSeeds(ctx.user.id));
}

/** POST /api/seeds - guarda una Seed String propia. */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, createSeedSchema);
    return ctx.store.createSeed(ctx.user.id, input);
  });
}

export const dynamic = 'force-dynamic';
