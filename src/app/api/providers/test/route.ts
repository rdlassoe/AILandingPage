import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { getProvider } from '@/lib/llm/registry';
import { testProviderSchema } from '@/lib/validation/schemas';
import type { ProviderId } from '@/types/llm';

/**
 * POST /api/providers/test
 * Prueba de conexion real contra el proveedor. Consume una llamada minima
 * y nunca devuelve la clave API.
 */
export async function POST(request: Request) {
  return withContext(async () => {
    const input = await parseBody(request, testProviderSchema);
    const provider = getProvider(input.providerId as ProviderId);
    return provider.testConnection();
  });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
