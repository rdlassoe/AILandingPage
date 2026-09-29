'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import type { GlobalSearchResults } from '@/lib/data/types';

/**
 * Busqueda global sobre proyectos, prompts, landings, tecnologias y seeds.
 * Consulta /api/search con debounce y cancela la peticion anterior.
 */
export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('search_failed'))))
        .then((data: { data: GlobalSearchResults }) => {
          setResults(data.data);
          setOpen(true);
        })
        .catch(() => {
          /* peticion cancelada o fallida: la UI simplemente no muestra resultados */
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const groups = results
    ? [
        { label: 'Proyectos', items: results.projects.map((p) => ({ id: p.id, name: p.basics.name, href: `/projects/${p.id}` })) },
        { label: 'Landing Pages', items: results.landingPages.map((l) => ({ id: l.id, name: l.name, href: `/library/${l.id}` })) },
        { label: 'Prompts', items: results.prompts.map((p) => ({ id: p.id, name: p.name, href: `/projects/${p.projectId ?? ''}` })) },
        { label: 'Tecnologias', items: results.technologies.map((t) => ({ id: t.id, name: t.name, href: '/technologies' })) },
      ].filter((group) => group.items.length > 0)
    : [];

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor="busqueda-global" className="sr-only">
        Buscar en el estudio
      </label>
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
      <input
        id="busqueda-global"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => results && setOpen(true)}
        placeholder="Buscar..."
        autoComplete="off"
        className="h-8 w-full border border-line-strong bg-bg pl-7 pr-2 text-[0.8125rem] text-ink placeholder:text-faint focus:border-accent"
      />

      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto border border-line-strong bg-panel shadow-sm">
          {loading ? <p className="px-3 py-2 text-xs text-faint">Buscando...</p> : null}
          {!loading && groups.length === 0 ? (
            <p className="px-3 py-2 text-xs text-faint">Sin resultados para &laquo;{query}&raquo;.</p>
          ) : null}
          {groups.map((group) => (
            <div key={group.label} className="border-b border-line last:border-b-0">
              <p className="eyebrow px-3 pt-2">{group.label}</p>
              <ul className="py-1">
                {group.items.map((item) => (
                  <li key={`${group.label}-${item.id}`}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="block truncate px-3 py-1.5 text-[0.8125rem] text-muted hover:bg-panel-2 hover:text-ink"
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
