import { withContext } from '@/app/api/_lib/route-helpers';
import { resolveCredentials } from '@/lib/credentials';
import { getRuntimeConfigSummary } from '@/lib/env';
import { getProviderSummaries } from '@/lib/llm/registry';
import { peekRateLimit } from '@/lib/rate-limit';

/** GET /api/providers - estado de los proveedores, sin exponer claves. */
export async function GET() {
  return withContext(async (ctx) => {
    const credentials = await resolveCredentials(ctx.store, ctx.user.id);
    return {
      providers: await getProviderSummaries(credentials),
      runtime: getRuntimeConfigSummary(credentials),
      rateLimit: peekRateLimit(ctx.user.id),
    };
  });
}

export const dynamic = 'force-dynamic';
