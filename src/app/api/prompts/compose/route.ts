import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { composeAndPersistPrompt } from '@/services/landing-generator';
import { composePromptSchema } from '@/lib/validation/schemas';
import type { ProviderId } from '@/types/llm';

/**
 * POST /api/prompts/compose
 * Compone el prompt final REAL (con LLM si hay proveedor configurado, que
 * reescribe las 17 secciones y manipula la Seed String) y lo persiste como
 * `prompt_version`, sin generar todavia ninguna Landing Page.
 *
 * A diferencia de `/api/prompts/generate` (aproximacion determinista,
 * gratuita), este endpoint puede gastar cuota de un proveedor real: es el
 * paso explicito que el usuario pulsa cuando quiere ver el prompt exacto
 * antes de decidir si generar el HTML.
 */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, composePromptSchema);

    return composeAndPersistPrompt(
      { ownerId: ctx.user.id, store: ctx.store },
      {
        ownerId: ctx.user.id,
        projectId: input.projectId,
        promptId: input.promptId,
        providerId: input.providerId as ProviderId | undefined,
        model: input.model,
      },
    );
  });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
