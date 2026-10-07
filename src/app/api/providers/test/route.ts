import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { resolveCredentials } from '@/lib/credentials';
import { getProvider } from '@/lib/llm/registry';
import { testProviderSchema } from '@/lib/validation/schemas';
import type { ProviderId } from '@/types/llm';

/**
 * POST /api/providers/test
 * Prueba de conexion real contra el proveedor. Consume una llamada minima
 * y nunca devuelve la clave API.
 */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, testProviderSchema);
    const provider = getProvider(input.providerId as ProviderId);
    // Se prueba con lo que usaria una generacion de este usuario: su clave de Ajustes o, si no, la del servidor.
    return provider.testConnection(await resolveCredentials(ctx.store, ctx.user.id));
  });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
