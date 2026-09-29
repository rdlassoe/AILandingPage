import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BookMarked,
  Boxes,
  FlaskConical,
  PanelsTopLeft,
  Plus,
  Settings,
  SquareTerminal,
} from 'lucide-react';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { Alert, Badge, EmptyState, LinkButton, Metric, Panel, PanelBody, PanelHeader } from '@/components/ui';
import { requireContext } from '@/lib/auth/session';
import { getStorageMode } from '@/lib/data';
import { getProviderSummaries } from '@/lib/llm/registry';
import { formatDuration, formatRelative, pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { user, store } = await requireContext();

  const [stats, projects, landings, generations, technologies] = await Promise.all([
    store.getDashboardStats(user.id),
    store.listProjects(user.id, { limit: 5 }),
    store.listLandingPages(user.id, { limit: 6 }),
    store.listGenerations(user.id, { limit: 6 }),
    store.listTechnologies(user.id),
  ]);

  const providers = await getProviderSummaries();
  const configuredProviders = providers.filter((provider) => provider.id !== 'mock' && provider.configured);
  const storageMode = getStorageMode();

  return (
    <>
      <PageHeader
        eyebrow="Vista general"
        title={`Hola, ${user.displayName}`}
        description="Define un proyecto, compon el prompt, genera la pagina y audita el resultado."
        actions={
          <>
            <LinkButton href="/projects/new" variant="primary">
              <Plus className="size-4" aria-hidden="true" />
              Nuevo proyecto
            </LinkButton>
            <LinkButton href="/prompt-studio">
              <SquareTerminal className="size-4" aria-hidden="true" />
              Prompt Studio
            </LinkButton>
          </>
        }
      />

      <PageBody>
        {configuredProviders.length === 0 ? (
          <Alert
            tone="warn"
            title="Ningun proveedor de IA configurado: estas en modo demo"
            actions={
              <LinkButton href="/settings" size="sm">
                Configurar
              </LinkButton>
            }
          >
            Todo el flujo funciona, pero las Landing Pages las produce el generador determinista de la
            aplicacion, no un modelo. Quedan marcadas como <strong>demo</strong> en toda la interfaz.
          </Alert>
        ) : null}

        {/* Metricas: solo lo que ayuda a decidir el siguiente paso */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Proyectos" value={stats.projects} hint={`${technologies.length} tecnologias disponibles`} />
          <Metric
            label="Landing Pages"
            value={stats.landingPages}
            hint={`${stats.prompts} ${pluralize(stats.prompts, 'prompt guardado', 'prompts guardados')}`}
          />
          <Metric
            label="Generaciones"
            value={stats.generations}
            hint={
              stats.generations > 0
                ? `${stats.successfulGenerations} ${pluralize(stats.successfulGenerations, 'correcta', 'correctas')} · ${stats.mockGenerations} en demo`
                : 'Todavia sin ejecutar'
            }
          />
          <Metric
            label="Ultima generacion"
            value={<span className="text-base">{formatRelative(stats.lastGenerationAt)}</span>}
            hint={stats.averageLatencyMs ? `Latencia media ${formatDuration(stats.averageLatencyMs)}` : undefined}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Proyectos recientes */}
          <Panel>
            <PanelHeader
              eyebrow="Trabajo en curso"
              title="Proyectos recientes"
              actions={
                <Link href="/projects" className="text-xs text-accent underline underline-offset-2">
                  Ver todos
                </Link>
              }
            />
            {projects.length === 0 ? (
              <PanelBody>
                <EmptyState
                  icon={PanelsTopLeft}
                  title="Aun no has creado ningun proyecto"
                  description="Un proyecto guarda el brief, el stack y las restricciones. Es el punto de partida de todo prompt."
                  action={
                    <LinkButton href="/projects/new" variant="primary" size="sm">
                      Crear el primero
                    </LinkButton>
                  }
                />
              </PanelBody>
            ) : (
              <ul className="divide-y divide-line">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-panel-2 sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{project.basics.name}</p>
                        <p className="truncate text-xs text-muted">
                          {project.basics.theme} &middot; {project.basics.targetAudience}
                        </p>
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        <Badge tone={project.status === 'generated' ? 'ok' : 'neutral'}>{project.status}</Badge>
                        <ArrowRight className="size-4 text-faint" aria-hidden="true" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Accesos y estado */}
          <div className="grid gap-5">
            <Panel>
              <PanelHeader eyebrow="Atajos" title="Empezar por aqui" />
              <ul className="divide-y divide-line">
                {[
                  { href: '/projects/new', icon: Plus, label: 'Crear proyecto', hint: 'Asistente en 5 pasos' },
                  { href: '/prompt-studio', icon: SquareTerminal, label: 'Generador de prompts', hint: 'Componer y ejecutar' },
                  { href: '/library', icon: BookMarked, label: 'Banco de Landing Pages', hint: 'Reutilizar y versionar' },
                  { href: '/technologies', icon: Boxes, label: 'Tecnologias', hint: 'Reglas por stack' },
                  { href: '/settings', icon: Settings, label: 'Proveedores de IA', hint: 'Gemini, Groq, Ollama o demo' },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-panel-2 sm:px-5"
                      >
                        <Icon className="size-4 flex-none text-faint" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{item.label}</span>
                          <span className="block truncate text-xs text-faint">{item.hint}</span>
                        </span>
                        <ArrowRight className="size-3.5 flex-none text-faint" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel>
              <PanelHeader eyebrow="Entorno" title="Estado del sistema" />
              <PanelBody className="space-y-2.5 text-sm">
                <Row label="Almacenamiento">
                  <Badge tone={storageMode === 'supabase' ? 'ok' : 'warn'}>
                    {storageMode === 'supabase' ? 'Supabase + RLS' : 'Local (.data)'}
                  </Badge>
                </Row>
                {providers.map((provider) => (
                  <Row key={provider.id} label={provider.label}>
                    <Badge tone={provider.configured ? 'ok' : 'neutral'}>
                      {provider.configured ? 'Disponible' : 'Sin clave'}
                    </Badge>
                  </Row>
                ))}
              </PanelBody>
            </Panel>
          </div>
        </div>

        {/* Ultimas landings */}
        <Panel>
          <PanelHeader
            eyebrow="Biblioteca"
            title="Landing Pages recientes"
            actions={
              <Link href="/library" className="text-xs text-accent underline underline-offset-2">
                Ver biblioteca
              </Link>
            }
          />
          {landings.length === 0 ? (
            <PanelBody>
              <EmptyState
                icon={BookMarked}
                title="Todavia no hay Landing Pages guardadas"
                description="En cuanto generes una desde el Prompt Studio aparecera aqui, junto con el prompt que la produjo."
              />
            </PanelBody>
          ) : (
            <PanelBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {landings.map((landing) => (
                <Link
                  key={landing.id}
                  href={`/library/${landing.id}`}
                  className="group border border-line bg-panel p-3 transition-colors hover:border-line-strong hover:bg-panel-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium text-ink">{landing.name}</p>
                    {landing.isMock ? <Badge tone="warn">demo</Badge> : <Badge tone="accent">{landing.providerId}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{landing.description || 'Sin descripcion.'}</p>
                  <p className="mt-2 font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
                    v{landing.currentVersion} &middot; {formatRelative(landing.updatedAt)}
                  </p>
                </Link>
              ))}
            </PanelBody>
          )}
        </Panel>

        {/* Observabilidad de generaciones */}
        {generations.length > 0 ? (
          <Panel>
            <PanelHeader
              eyebrow="Observabilidad"
              title="Ultimas ejecuciones"
              description="Proveedor, modelo, estado y latencia de cada llamada. Nunca se almacenan claves API."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-faint">
                    <Th>Tipo</Th>
                    <Th>Proveedor</Th>
                    <Th>Modelo</Th>
                    <Th>Estado</Th>
                    <Th>Latencia</Th>
                    <Th>Cuando</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {generations.map((generation) => (
                    <tr key={generation.id}>
                      <Td>{generation.kind}</Td>
                      <Td>
                        <span className="font-mono text-xs">{generation.providerId}</span>
                        {generation.isMock ? <span className="ml-1.5 text-xs text-warn">demo</span> : null}
                      </Td>
                      <Td className="font-mono text-xs text-muted">{generation.model || '—'}</Td>
                      <Td>
                        <Badge
                          tone={
                            generation.status === 'success'
                              ? 'ok'
                              : generation.status === 'pending'
                                ? 'neutral'
                                : 'danger'
                          }
                        >
                          {generation.status}
                        </Badge>
                      </Td>
                      <Td className="font-mono text-xs text-muted">
                        {generation.latencyMs > 0 ? formatDuration(generation.latencyMs) : '—'}
                      </Td>
                      <Td className="text-xs text-muted">{formatRelative(generation.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <Panel>
            <PanelBody>
              <EmptyState
                icon={FlaskConical}
                title="Sin generaciones todavia"
                description="Cada ejecucion queda registrada con proveedor, modelo, estado y latencia para poder diagnosticar problemas."
              />
            </PanelBody>
          </Panel>
        )}
      </PageBody>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 font-medium uppercase tracking-wider sm:px-5">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 sm:px-5 ${className ?? ''}`}>{children}</td>;
}
