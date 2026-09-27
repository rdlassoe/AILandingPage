import type { Metadata } from 'next';
import Link from 'next/link';
import { BookMarked, Star } from 'lucide-react';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { Badge, EmptyState, Input, LinkButton, Panel, PanelBody, PanelHeader, Select } from '@/components/ui';
import { requireContext } from '@/lib/auth/session';
import { LANDING_CATEGORIES } from '@/lib/data/catalog';
import { cn, formatBytes, formatRelative } from '@/lib/utils';
import type { LandingPage, LandingStatus } from '@/types/domain';
import type { ProviderId } from '@/types/llm';

export const metadata: Metadata = { title: 'Landing Library' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'draft', label: 'Borrador' },
  { value: 'private', label: 'Privada' },
  { value: 'public', label: 'Publica' },
  { value: 'featured', label: 'Destacada' },
];

const PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Cualquier proveedor' },
  { value: 'mock', label: 'Modo demo' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'groq', label: 'Groq' },
];

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    provider?: string;
    technology?: string;
    category?: string;
  }>;
}) {
  const { user, store } = await requireContext();
  const filters = await searchParams;

  const [landings, featured, technologies] = await Promise.all([
    store.listLandingPages(user.id, {
      search: filters.q,
      status: (filters.status || undefined) as LandingStatus | undefined,
      providerId: (filters.provider || undefined) as ProviderId | undefined,
      technologyId: filters.technology || undefined,
      category: filters.category || undefined,
    }),
    store.listPublicLandingPages({ limit: 6 }),
    store.listTechnologies(user.id),
  ]);

  const technologyNames = new Map(technologies.map((tech) => [tech.id, tech.name]));

  return (
    <>
      <PageHeader
        eyebrow="Biblioteca"
        title="Landing Library"
        description="Cada pagina guardada conserva el prompt y la version que la produjo, para poder reutilizarla o volver a ejecutarla."
        actions={
          <LinkButton href="/prompt-studio" variant="primary">
            Generar una nueva
          </LinkButton>
        }
      />

      <PageBody>
        {/* Filtros combinables */}
        <form className="flex flex-wrap items-end gap-2" role="search">
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="sr-only">
              Buscar Landing Pages
            </label>
            <Input id="q" name="q" type="search" defaultValue={filters.q ?? ''} placeholder="Buscar por nombre" />
          </div>
          <FilterSelect id="status" name="status" label="Estado" value={filters.status} options={STATUS_OPTIONS} />
          <FilterSelect
            id="provider"
            name="provider"
            label="Proveedor"
            value={filters.provider}
            options={PROVIDER_OPTIONS}
          />
          <FilterSelect
            id="technology"
            name="technology"
            label="Tecnologia"
            value={filters.technology}
            options={[
              { value: '', label: 'Cualquier tecnologia' },
              ...technologies.map((tech) => ({ value: tech.id, label: tech.name })),
            ]}
          />
          <FilterSelect
            id="category"
            name="category"
            label="Categoria"
            value={filters.category}
            options={[
              { value: '', label: 'Cualquier categoria' },
              ...LANDING_CATEGORIES.map((category) => ({ value: category, label: category })),
            ]}
          />
          <button type="submit" className="h-9 border border-line-strong px-3 text-sm text-ink hover:bg-panel-2">
            Filtrar
          </button>
        </form>

        {landings.length === 0 ? (
          <Panel>
            <PanelBody>
              <EmptyState
                icon={BookMarked}
                title="La biblioteca esta vacia"
                description="Genera tu primera Landing Page desde el Prompt Studio: se guardara aqui junto al prompt que la produjo."
                action={
                  <LinkButton href="/prompt-studio" variant="primary" size="sm">
                    Ir al Prompt Studio
                  </LinkButton>
                }
              />
            </PanelBody>
          </Panel>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {landings.map((landing) => (
              <li key={landing.id}>
                <LandingCard landing={landing} technologyNames={technologyNames} />
              </li>
            ))}
          </ul>
        )}

        {/* Destacadas: paginas publicas de la instancia */}
        {featured.length > 0 ? (
          <Panel>
            <PanelHeader
              eyebrow="Publicas"
              title={
                <span className="flex items-center gap-1.5">
                  <Star className="size-3.5" aria-hidden="true" />
                  Landing Pages destacadas
                </span>
              }
              description="Paginas marcadas como publicas o destacadas. Puedes previsualizarlas, ver su prompt y reutilizarlas."
            />
            <PanelBody>
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {featured.map((landing) => (
                  <li key={landing.id}>
                    <LandingCard landing={landing} technologyNames={technologyNames} />
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        ) : null}
      </PageBody>
    </>
  );
}

function LandingCard({
  landing,
  technologyNames,
}: {
  landing: LandingPage;
  technologyNames: Map<string, string>;
}) {
  return (
    <Link
      href={`/library/${landing.id}`}
      className="flex h-full flex-col border border-line bg-panel transition-colors hover:border-line-strong"
    >
      {/* Miniatura real: el propio documento renderizado y reducido a escala */}
      <div className="relative h-40 overflow-hidden border-b border-line bg-white">
        <iframe
          title={`Vista previa de ${landing.name}`}
          srcDoc={landing.html}
          sandbox=""
          loading="lazy"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none h-[1000px] w-[1280px] origin-top-left border-0"
          style={{ transform: 'scale(0.31)' }}
        />
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate font-medium text-ink">{landing.name}</h3>
          {landing.isMock ? <Badge tone="warn">demo</Badge> : <Badge tone="accent">{landing.providerId}</Badge>}
        </div>

        <p className="mt-1 line-clamp-2 flex-1 text-xs text-muted">{landing.description || 'Sin descripcion.'}</p>

        {landing.technologyIds.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1">
            {landing.technologyIds.slice(0, 3).map((id) => (
              <li key={id} className="border border-line px-1.5 py-0.5 font-mono text-[0.6875rem] text-faint">
                {technologyNames.get(id) ?? id}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2 font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
          <span>
            v{landing.currentVersion} &middot; {formatBytes(landing.metadata.sizeBytes)}
          </span>
          <span
            className={cn(
              landing.status === 'featured' && 'text-accent',
              landing.status === 'public' && 'text-ok',
            )}
          >
            {landing.status}
          </span>
        </div>
        <p className="mt-1 font-mono text-[0.6875rem] text-faint">{formatRelative(landing.updatedAt)}</p>
      </div>
    </Link>
  );
}

function FilterSelect({
  id,
  name,
  label,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="w-44">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} name={name} defaultValue={value ?? ''}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
