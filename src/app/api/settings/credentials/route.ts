import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { clearCredentials, getCredentialsStatus, saveCredentials } from '@/lib/credentials';
import { saveCredentialsSchema } from '@/lib/validation/schemas';

/**
 * Credenciales de los proveedores (Gemini, Groq, Ollama, Cloudflare) del usuario.
 *
 * NINGUNA respuesta lleva un valor guardado: solo de donde sale cada campo ("settings", "env" o
 * "none") y los cuatro ultimos caracteres. Escribir es la unica forma de cambiarlas: no existe
 * una operacion que las devuelva.
 */

/** GET /api/settings/credentials - estado (sin valores) de cada credencial. */
export async function GET() {
  return withContext((ctx) => getCredentialsStatus(ctx.store, ctx.user.id));
}

/**
 * PUT /api/settings/credentials - cambio parcial. Un campo ausente no se toca; `null` o una
 * cadena vacia lo borra. Se valida todo antes de guardar nada.
 */
export async function PUT(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, saveCredentialsSchema);
    return saveCredentials(ctx.store, ctx.user.id, input);
  });
}

/** DELETE /api/settings/credentials - borra todo lo guardado (el entorno del servidor no se toca). */
export async function DELETE() {
  return withContext((ctx) => clearCredentials(ctx.store, ctx.user.id));
}

export const dynamic = 'force-dynamic';
