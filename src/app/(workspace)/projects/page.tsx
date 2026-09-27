import type { Metadata } from 'next';
import Link from 'next/link';
import { PanelsTopLeft, Plus } from 'lucide-react';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { Badge, EmptyState, Input, LinkButton, Panel, Select } from '@/components/ui';
import { requireContext } from '@/lib/auth/session';
import { formatRelative } from '@/lib/utils';
import type { ProjectStatus } from '@/types/domain';

export const metadata: Metadata = { title: 'Proyectos' };
export const dynamic = 'force-dynamic';

const STATUSES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'draft', label: 'Borrador' },
  { value: 'defined', label: 'Definido' },
  { value: 'generated', label: 'Generado' },
  { value: 'archived', label: 'Archivado' },
];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; technology?: string }>;
}) {
  const { user, store } = await requireContext();
  const filters = await searchParams;

  const [projects, technologies] = await Promise.all([
    store.listProjects(user.id, {
      search: filters.q,
      status: (filters.status || undefined) as ProjectStatus | undefined,
      technologyId: filters.technology || undefined,
    }),
    store.listTechnologies(user.id),
  ]);

  const technologyNames = new Map(technologies.map((tech) => [tech.id, tech.name]));

  return (
    <>
      <PageHeader
        eyebrow="Define"
        title="Proyectos"
        description="Cada proyecto guarda el brief, el stack, la Seed String y las restricciones que alimentan el Prompt Engine."
        actions={
          <LinkButton href="/projects/new" variant="primary">
            <Plus className="size-4" aria-hidden="true" />
            Nuevo proyecto
          </LinkButton>
        }
      />

      <PageBody>
        {/* Filtros combinables, enviados por GET para que la URL sea compartible */}
        <form className="flex flex-wrap items-end gap-2" role="search">
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="sr-only">
              Buscar proyectos
            </label>
            <Input id="q" name="q" type="search" defaultValue={filters.q ?? ''} placeholder="Buscar por nombre o tema" />
          </div>
          <div className="w-44">
            <label htmlFor="status" className="sr-only">
              Estado
            </label>
            <Select id="status" name="status" defaultValue={filters.status ?? ''}>
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <label htmlFor="technology" className="sr-only">
              Tecnologia
            </label>
            <Select id="technology" name="technology" defaultValue={filters.technology ?? ''}>
              <option value="">Cualquier tecnologia</option>
              {technologies.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.name}
                </option>
              ))}
            </Select>
          </div>
          <button
            type="submit"
            className="h-9 border border-line-strong px-3 text-sm text-ink hover:bg-panel-2"
          >
            Filtrar
          </button>
        </form>

        {projects.length === 0 ? (
          <Panel>
            <div className="p-5">
              <EmptyState
                icon={PanelsTopLeft}
                title="No hay proyectos que coincidan"
                description="Crea uno nuevo o ajusta los filtros."
                action={
                  <LinkButton href="/projects/new" variant="primary" size="sm">
                    Crear proyecto
                  </LinkButton>
                }
              />
            </div>
          </Panel>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="flex h-full flex-col border border-line bg-panel p-4 transition-colors hover:border-line-strong hover:bg-panel-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="min-w-0 flex-1 truncate font-medium text-ink">{project.basics.name}</h2>
                    <Badge tone={project.status === 'generated' ? 'ok' : 'neutral'}>{project.status}</Badge>
                  </div>

                  <p className="mt-1.5 line-clamp-2 flex-1 text-sm text-muted">{project.basics.description}</p>

                  <dl className="mt-3 grid gap-1 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 flex-none text-faint">Publico</dt>
                      <dd className="min-w-0 truncate text-muted">{project.basics.targetAudience}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 flex-none text-faint">CTA</dt>
                      <dd className="min-w-0 truncate text-muted">{project.basics.primaryCta}</dd>
                    </div>
                  </dl>

                  {project.technical.technologyIds.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-1">
                      {project.technical.technologyIds.slice(0, 4).map((id) => (
                        <li
                          key={id}
                          className="border border-line px-1.5 py-0.5 font-mono text-[0.6875rem] text-faint"
                        >
                          {technologyNames.get(id) ?? id}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <p className="mt-3 border-t border-line pt-2 font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
                    {formatRelative(project.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
