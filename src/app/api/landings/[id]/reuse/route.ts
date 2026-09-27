import { withContext } from '@/app/api/_lib/route-helpers';
import { notFound } from '@/lib/errors';
import { truncate } from '@/lib/utils';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/landings/[id]/reuse
 *
 * Clona el proyecto que produjo la Landing Page (brief, stack, Seed String y
 * restricciones) en un proyecto nuevo, listo para modificar antes de volver a
 * generar. No copia la pagina: copia las decisiones que la produjeron.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  return withContext(async (ctx) => {
    const landing = await ctx.store.getLandingPage(ctx.user.id, id);
    if (!landing) throw notFound('esa Landing Page');

    const source = landing.projectId ? await ctx.store.getProject(ctx.user.id, landing.projectId) : null;

    // Una landing publica de otra cuenta no expone su proyecto: se crea uno
    // minimo a partir de los metadatos publicos de la pagina.
    const project = source
      ? await ctx.store.createProject(ctx.user.id, {
          status: 'draft',
          basics: { ...source.basics, name: truncate(`${source.basics.name} (copia)`, 120) },
          visual: source.visual,
          technical: source.technical,
          content: source.content,
          seedStringId: source.seedStringId,
          seedStringValue: source.seedStringValue,
          negativeConstraints: source.negativeConstraints,
          discover: source.discover,
          define: source.define,
        })
      : await ctx.store.createProject(ctx.user.id, {
          status: 'draft',
          basics: {
            name: truncate(`${landing.name} (reutilizada)`, 120),
            theme: landing.category ?? 'landing page',
            description: landing.description || 'Proyecto creado a partir de una Landing Page de la biblioteca.',
            landingType: 'other',
            targetAudience: '',
            primaryGoal: '',
            productOrService: landing.name,
            primaryCta: '',
          },
          visual: {
            style: '',
            colors: [],
            typography: '',
            sophistication: 3,
            references: [],
            avoid: [],
          },
          technical: {
            technologyIds: landing.technologyIds,
            framework: null,
            libraries: [],
            constraints: [],
          },
          content: { sections: landing.metadata.sections, features: [], benefits: [], keyMessage: '', tone: 'directo' },
          seedStringId: null,
          seedStringValue: landing.metadata.seedStringValue,
          negativeConstraints: [],
          discover: null,
          define: null,
        });

    return { projectId: project.id };
  });
}

export const dynamic = 'force-dynamic';
