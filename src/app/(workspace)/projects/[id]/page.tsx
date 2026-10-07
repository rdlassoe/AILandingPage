import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookMarked, SquareTerminal } from 'lucide-react';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { DeleteProjectButton, ProjectPhases } from '@/features/projects/project-phases';
import { Badge, DefinitionList, EmptyState, LinkButton, Panel, PanelBody, PanelHeader } from '@/components/ui';
import { requireContext } from '@/lib/auth/session';
import { getUserCredentials } from '@/lib/credentials/server';
import { env } from '@/lib/env';
import { getProvider } from '@/lib/llm/registry';
import { formatDateTime, formatRelative } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { user, store } = await requireContext();
  const project = await store.getProject(user.id, id);
  return { title: project ? project.basics.name : 'Proyecto' };
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, store } = await requireContext();

  const project = await store.getProject(user.id, id);
  if (!project) notFound();

  const [technologies, landings, prompts] = await Promise.all([
    store.getTechnologiesByIds(project.technical.technologyIds),
    store.listLandingPages(user.id, { projectId: project.id }),
    store.listPrompts(user.id, { projectId: project.id }),
  ]);

  const provider = getProvider(env.llm.defaultProvider);
  const usingMock = !provider.isConfigured(await getUserCredentials(user.id));

  // El asistente ya no pregunta por estilo ni restricciones: solo se muestran estos
  // paneles en proyectos antiguos que si los tienen (sin valores por defecto fantasma).
  const { visual } = project;
  const hasVisualBrief =
    visual.style.trim() !== '' ||
    visual.typography.trim() !== '' ||
    visual.colors.length > 0 ||
    visual.references.length > 0 ||
    visual.avoid.length > 0 ||
    visual.sophistication !== 3;

  return (
    <>
      <PageHeader
        eyebrow={`Proyecto · ${project.basics.landingType}`}
        title={project.basics.name}
        description={project.basics.description}
        actions={
          <>
            <LinkButton href={`/prompt-studio?project=${project.id}`} variant="primary">
              <SquareTerminal className="size-4" aria-hidden="true" />
              Abrir en Prompt Studio
            </LinkButton>
            <Badge tone={project.status === 'generated' ? 'ok' : 'neutral'}>{project.status}</Badge>
          </>
        }
      />

      <PageBody>
        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <div className="grid gap-5">
            <ProjectPhases
              projectId={project.id}
              discover={project.discover}
              define={project.define}
              isMockProvider={usingMock}
            />

            <Panel>
              <PanelHeader eyebrow="Biblioteca" title="Landing Pages de este proyecto" />
              {landings.length === 0 ? (
                <PanelBody>
                  <EmptyState
                    icon={BookMarked}
                    title="Sin Landing Pages todavia"
                    description="Abre el Prompt Studio, revisa el prompt y ejecuta la primera generacion."
                    action={
                      <LinkButton href={`/prompt-studio?project=${project.id}`} variant="primary" size="sm">
                        Generar la primera
                      </LinkButton>
                    }
                  />
                </PanelBody>
              ) : (
                <ul className="divide-y divide-line">
                  {landings.map((landing) => (
                    <li key={landing.id}>
                      <Link
                        href={`/library/${landing.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-panel-2 sm:px-5"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{landing.name}</p>
                          <p className="truncate text-xs text-muted">
                            v{landing.currentVersion} &middot; {landing.model || landing.providerId} &middot;{' '}
                            {formatRelative(landing.updatedAt)}
                          </p>
                        </div>
                        <div className="flex flex-none items-center gap-2">
                          {landing.isMock ? <Badge tone="warn">demo</Badge> : null}
                          <Badge tone={landing.status === 'public' || landing.status === 'featured' ? 'ok' : 'neutral'}>
                            {landing.status}
                          </Badge>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-5">
            <Panel>
              <PanelHeader eyebrow="Brief" title="Informacion basica" />
              <PanelBody>
                <DefinitionList
                  items={[
                    { term: 'Tema', value: project.basics.theme },
                    { term: 'Producto o servicio', value: project.basics.productOrService },
                    { term: 'Publico objetivo', value: project.basics.targetAudience },
                    { term: 'Objetivo principal', value: project.basics.primaryGoal },
                    { term: 'CTA principal', value: project.basics.primaryCta },
                    { term: 'Tono', value: project.content.tone },
                  ]}
                />
              </PanelBody>
            </Panel>

            {hasVisualBrief ? (
            <Panel>
              <PanelHeader
                eyebrow="Direccion visual"
                title="Estilo"
                description="Fijada en el proyecto. Lo que no este aqui lo decide quien redacta el prompt."
              />
              <PanelBody>
                <DefinitionList
                  items={[
                    { term: 'Estilo', value: project.visual.style || '—' },
                    { term: 'Tipografia', value: project.visual.typography || '—' },
                    { term: 'Sofisticacion', value: `${project.visual.sophistication} / 5` },
                    {
                      term: 'Colores',
                      value:
                        project.visual.colors.length > 0 ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            {project.visual.colors.map((color) => (
                              <span key={color} className="inline-flex items-center gap-1 font-mono text-xs">
                                <span
                                  aria-hidden="true"
                                  className="inline-block size-3 border border-line-strong"
                                  style={{ background: color }}
                                />
                                {color}
                              </span>
                            ))}
                          </span>
                        ) : (
                          '—'
                        ),
                    },
                  ]}
                />
              </PanelBody>
            </Panel>
            ) : null}

            <Panel>
              <PanelHeader eyebrow="Stack" title="Tecnologias" />
              <PanelBody className="space-y-2">
                {technologies.length === 0 ? (
                  <p className="text-sm text-muted">Sin tecnologias seleccionadas: se usara HTML, CSS y JavaScript.</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {technologies.map((tech) => (
                      <li key={tech.id} className="flex items-start justify-between gap-2 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{tech.name}</span>
                          {tech.version ? <span className="ml-1 font-mono text-xs text-faint">{tech.version}</span> : null}
                          <span className="block text-xs text-muted">{tech.description}</span>
                        </span>
                        <Badge>{tech.category}</Badge>
                      </li>
                    ))}
                  </ul>
                )}

                {project.technical.constraints.length > 0 ? (
                  <div className="border-t border-line pt-2">
                    <p className="eyebrow mb-1">Restricciones tecnicas</p>
                    <ul className="grid gap-0.5 text-xs text-muted">
                      {project.technical.constraints.map((item) => (
                        <li key={item}>&middot; {item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </PanelBody>
            </Panel>

            {project.negativeConstraints.length > 0 ? (
            <Panel>
              <PanelHeader
                eyebrow="Restricciones negativas"
                title={`${project.negativeConstraints.length} reglas propias`}
                description="Se anaden a la lista de la tecnica Restricciones negativas, y solo si esa tecnica esta elegida en el Prompt Studio."
              />
              <PanelBody>
                <ul className="grid gap-1 text-sm text-muted">
                  {project.negativeConstraints.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-danger" aria-hidden="true">
                        &times;
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </PanelBody>
            </Panel>
            ) : null}

            <Panel>
              <PanelHeader eyebrow="Trazabilidad" title="Historial" />
              <PanelBody className="space-y-2 text-sm">
                <p className="text-muted">
                  Creado el <span className="text-ink">{formatDateTime(project.createdAt)}</span>
                </p>
                <p className="text-muted">
                  Actualizado <span className="text-ink">{formatRelative(project.updatedAt)}</span>
                </p>
                <p className="text-muted">
                  {prompts.length} {prompts.length === 1 ? 'prompt guardado' : 'prompts guardados'}
                  {prompts[0] ? ` · version actual v${prompts[0].currentVersion}` : ''}
                </p>
                <div className="border-t border-line pt-3">
                  <DeleteProjectButton projectId={project.id} projectName={project.basics.name} />
                </div>
              </PanelBody>
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
