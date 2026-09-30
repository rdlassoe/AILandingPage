import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { LandingPreview } from '@/components/preview/landing-preview';
import { LandingActions } from '@/features/library/landing-actions';
import { Badge, DefinitionList, Panel, PanelBody, PanelHeader } from '@/components/ui';
import { requireContext } from '@/lib/auth/session';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/utils';
import { MANUAL_EDIT_LABEL } from '@/types/domain';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { user, store } = await requireContext();
  const landing = await store.getLandingPage(user.id, id);
  return { title: landing ? landing.name : 'Landing Page' };
}

export default async function LandingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, store } = await requireContext();

  const landing = await store.getLandingPage(user.id, id);
  if (!landing) notFound();

  const isOwner = landing.ownerId === user.id;

  const [versions, reviews, promptVersion, technologies, project] = await Promise.all([
    isOwner ? store.listLandingVersions(user.id, landing.id) : Promise.resolve([]),
    isOwner ? store.listReviews(user.id, landing.id) : Promise.resolve([]),
    landing.promptVersionId && isOwner
      ? store.getPromptVersion(user.id, landing.promptVersionId)
      : Promise.resolve(null),
    store.getTechnologiesByIds(landing.technologyIds),
    landing.projectId && isOwner ? store.getProject(user.id, landing.projectId) : Promise.resolve(null),
  ]);

  const lastReview = reviews[0] ?? null;
  // La version vigente la escribio una persona, no el modelo: el HTML ya no es el que produjo el prompt.
  const currentVersion = versions.find((version) => version.version === landing.currentVersion);
  const editedByHand = currentVersion?.label === MANUAL_EDIT_LABEL;

  return (
    <>
      <PageHeader
        eyebrow={`Landing Page · v${landing.currentVersion}`}
        title={landing.name}
        description={landing.description}
        actions={
          <>
            {landing.isMock ? <Badge tone="warn">generada en modo demo</Badge> : <Badge tone="accent">{landing.providerId}</Badge>}
            {editedByHand ? <Badge tone="warn">editada a mano</Badge> : null}
            <Badge tone={landing.status === 'public' || landing.status === 'featured' ? 'ok' : 'neutral'}>
              {landing.status}
            </Badge>
          </>
        }
      />

      <PageBody>
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <div className="grid min-w-0 gap-5">
            <LandingPreview html={landing.html} title={`Vista previa de ${landing.name}`} />

            {promptVersion ? (
              <Panel>
                <PanelHeader
                  eyebrow="Trazabilidad"
                  title={`Prompt que produjo esta pagina (v${promptVersion.version})`}
                  description={promptVersion.changeNote}
                />
                <PanelBody className="space-y-3">
                  {editedByHand ? (
                    <div className="border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-muted">
                      Esta pagina se edito a mano despues de generarse: el HTML actual ya no es exactamente el que
                      produjo este prompt. Las versiones anteriores siguen en el historial.
                    </div>
                  ) : null}
                  <DefinitionList
                    items={[
                      { term: 'Proveedor', value: landing.providerId },
                      { term: 'Modelo', value: landing.model || '—' },
                      {
                        term: 'Seed String',
                        // Cadena hexadecimal larga y sin espacios: sin `break-all` ensancha toda
                        // la columna y la pagina se desborda en pantallas estrechas.
                        value: (
                          <span className="break-all">{promptVersion.seedStringValue || 'sin Seed String'}</span>
                        ),
                      },
                      { term: 'Creado', value: formatDateTime(promptVersion.createdAt) },
                    ]}
                  />

                  {promptVersion.conflicts.length > 0 ? (
                    <div className="border border-warn/40 bg-warn-soft px-3 py-2 text-xs">
                      <p className="font-medium text-ink">Conflictos de stack resueltos</p>
                      <ul className="mt-1 grid gap-0.5 text-muted">
                        {promptVersion.conflicts.map((conflict) => (
                          <li key={conflict.reason}>
                            &middot; {conflict.reason} {conflict.resolution}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <details className="border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
                      Ver el prompt completo ({promptVersion.content.length.toLocaleString('es-ES')} caracteres)
                    </summary>
                    <pre className="max-h-96 overflow-auto border-t border-line bg-bg p-3 font-mono text-xs leading-relaxed text-muted">
                      {promptVersion.content}
                    </pre>
                  </details>

                  {promptVersion.negativeConstraints.length > 0 ? (
                    <div>
                      <p className="eyebrow mb-1">Restricciones negativas aplicadas</p>
                      <ul className="grid gap-0.5 text-xs text-muted">
                        {promptVersion.negativeConstraints.map((item) => (
                          <li key={item}>&times; {item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </PanelBody>
              </Panel>
            ) : null}

            {lastReview ? (
              <Panel>
                <PanelHeader
                  eyebrow="Ultima auditoria"
                  title={`Puntuacion global ${lastReview.scores.overall}/100`}
                  description={`${lastReview.issues.length} problemas · ${formatRelative(lastReview.createdAt)}`}
                />
                <PanelBody className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {(
                      [
                        ['UX', lastReview.scores.ux],
                        ['Accesibilidad', lastReview.scores.accessibility],
                        ['Contenido', lastReview.scores.content],
                        ['Codigo', lastReview.scores.code],
                        ['Diseno', lastReview.scores.design],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="border border-line px-2.5 py-2">
                        <p className="eyebrow">{label}</p>
                        <p className="mt-1 font-mono text-lg leading-none text-ink">{value}</p>
                      </div>
                    ))}
                  </div>

                  <ul className="grid gap-1.5">
                    {lastReview.issues.slice(0, 6).map((issue) => (
                      <li key={issue.id} className="flex items-start gap-2 text-sm">
                        <Badge tone={issue.severity === 'critical' || issue.severity === 'high' ? 'danger' : 'neutral'}>
                          {issue.severity}
                        </Badge>
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{issue.title}</span>
                          <span className="block text-xs text-muted">{issue.description}</span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={`/prompt-studio?project=${landing.projectId ?? ''}`}
                    className="inline-flex h-8 items-center border border-line-strong px-2.5 text-[0.8125rem] text-ink hover:bg-panel-2"
                  >
                    Continuar refinando en el Prompt Studio
                  </Link>
                </PanelBody>
              </Panel>
            ) : null}
          </div>

          <div className="grid gap-5">
            {isOwner ? (
              <Panel>
                <PanelHeader eyebrow="Acciones" title="Gestionar esta pagina" />
                <PanelBody>
                  <LandingActions landing={landing} />
                </PanelBody>
              </Panel>
            ) : (
              <Panel>
                <PanelHeader eyebrow="Publica" title="Pagina de otra cuenta" />
                <PanelBody>
                  <p className="text-sm text-muted">
                    Esta Landing Page es publica. Puedes previsualizarla y reutilizar su planteamiento, pero no
                    editarla.
                  </p>
                </PanelBody>
              </Panel>
            )}

            <Panel>
              <PanelHeader eyebrow="Ficha" title="Datos" />
              <PanelBody>
                <DefinitionList
                  className="sm:grid-cols-1"
                  items={[
                    { term: 'Proyecto', value: project ? <Link href={`/projects/${project.id}`} className="text-accent underline underline-offset-2">{project.basics.name}</Link> : '—' },
                    { term: 'Categoria', value: landing.category ?? '—' },
                    {
                      term: 'Tecnologias',
                      value: technologies.length > 0 ? technologies.map((tech) => tech.name).join(', ') : '—',
                    },
                    { term: 'Tamano', value: formatBytes(landing.metadata.sizeBytes) },
                    {
                      term: 'Contenido',
                      value: `${landing.metadata.hasStyle ? 'CSS' : 'sin CSS'} · ${landing.metadata.hasScript ? 'JS' : 'sin JS'}`,
                    },
                    {
                      term: 'Secciones detectadas',
                      value: landing.metadata.sections.length > 0 ? landing.metadata.sections.join(', ') : '—',
                    },
                    { term: 'Creada', value: formatDateTime(landing.createdAt) },
                    { term: 'Actualizada', value: formatRelative(landing.updatedAt) },
                  ]}
                />
              </PanelBody>
            </Panel>

            {versions.length > 0 ? (
              <Panel>
                <PanelHeader
                  eyebrow="Versionado"
                  title={`${versions.length} ${versions.length === 1 ? 'version' : 'versiones'}`}
                  description="Cada generacion y cada refinamiento crean una version nueva."
                />
                <ul className="divide-y divide-line">
                  {versions.map((version) => (
                    <li key={version.id} className="flex items-start justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          v{version.version}
                          {version.version === landing.currentVersion ? (
                            <span className="ml-2 font-mono text-[0.6875rem] uppercase tracking-wider text-accent">
                              actual
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted">{version.label}</p>
                      </div>
                      <span className="flex-none font-mono text-[0.6875rem] text-faint">
                        {formatRelative(version.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}
