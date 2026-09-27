import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { slugify } from '@/lib/utils';
import { createTechnologySchema } from '@/lib/validation/schemas';

/** GET /api/technologies - catalogo (presets + las del usuario). */
export async function GET() {
  return withContext(async (ctx) => ctx.store.listTechnologies(ctx.user.id));
}

/** POST /api/technologies - registra una tecnologia propia. */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, createTechnologySchema);
    return ctx.store.createTechnology(ctx.user.id, {
      ...input,
      slug: input.slug ? slugify(input.slug) : slugify(input.name),
    });
  });
}

export const dynamic = 'force-dynamic';
