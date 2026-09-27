import { withContext } from '@/app/api/_lib/route-helpers';
import { getRuntimeConfigSummary } from '@/lib/env';
import { getProviderSummaries } from '@/lib/llm/registry';
import { peekRateLimit } from '@/lib/rate-limit';

/** GET /api/providers - estado de los proveedores, sin exponer claves. */
export async function GET() {
  return withContext(async (ctx) => ({
    providers: await getProviderSummaries(),
    runtime: getRuntimeConfigSummary(),
    rateLimit: peekRateLimit(ctx.user.id),
  }));
}

export const dynamic = 'force-dynamic';
