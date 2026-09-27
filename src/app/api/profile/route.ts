import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { updateProfileSchema } from '@/lib/validation/schemas';
import type { ProviderId } from '@/types/llm';

/** GET /api/profile - perfil del usuario autenticado. */
export async function GET() {
  return withContext(async (ctx) => ctx.profile);
}

/** PATCH /api/profile - preferencias de proveedor y modelo. */
export async function PATCH(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, updateProfileSchema);
    return ctx.store.updateProfile(ctx.user.id, {
      displayName: input.displayName,
      preferredProvider: input.preferredProvider as ProviderId | undefined,
      preferredModel: input.preferredModel,
    });
  });
}

export const dynamic = 'force-dynamic';
