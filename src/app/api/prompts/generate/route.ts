import { parseBody, withContext } from '@/app/api/_lib/route-helpers';
import { notFound } from '@/lib/errors';
import { buildPromptSchema } from '@/lib/validation/schemas';
import { buildLandingPrompt, DEFAULT_TECHNIQUE_IDS, generateRandomSeedForMock } from '@/services/prompt-engine';
import type { DesignTechniqueId } from '@/types/services';

/**
 * POST /api/prompts/generate
 * Compone el prompt sin ejecutarlo, con `buildLandingPrompt` (determinista,
 * sin LLM). Permite revisarlo y editarlo antes de gastar cuota de ningun
 * proveedor.
 *
 * La Seed de esta vista previa siempre sale de `generateRandomSeedForMock`
 * (un string aleatorio real via `crypto.randomBytes`, no un LLM): pedirsela
 * a un LLM en cada pulsacion mientras el usuario ajusta tecnicas gastaria
 * cuota por nada, justo lo que este endpoint existe para evitar.
 *
 * Con un proveedor real esto es solo una APROXIMACION: al pulsar "Generar"
 * sin editar el texto, el servidor vuelve a componer el prompt con
 * `buildPromptForProject` (`landing-generator`), donde un LLM real genera su
 * propio string aleatorio y reescribe el prompt entero — el resultado no es
 * determinista y por tanto puede diferir de lo que se ve aqui.
 */
export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, buildPromptSchema);

    const project = await ctx.store.getProject(ctx.user.id, input.projectId);
    if (!project) throw notFound('ese proyecto');

    const technologyIds = input.technologyIds ?? project.technical.technologyIds;
    const technologies = await ctx.store.getTechnologiesByIds(technologyIds);

    return buildLandingPrompt({
      project,
      technologies,
      randomSeedString: generateRandomSeedForMock().randomString,
      negativeConstraints: input.negativeConstraints ?? project.negativeConstraints,
      designTechniques: (input.designTechniques as DesignTechniqueId[] | undefined) ?? DEFAULT_TECHNIQUE_IDS,
      discover: project.discover,
      define: project.define,
    });
  });
}

export const dynamic = 'force-dynamic';
