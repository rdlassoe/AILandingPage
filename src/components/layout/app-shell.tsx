'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BookMarked,
  Boxes,
  LayoutDashboard,
  Menu,
  PanelsTopLeft,
  Settings,
  SquareTerminal,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useActiveProvider } from './active-provider-context';
import { GlobalSearch } from './global-search';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Vista general' },
  { href: '/projects', label: 'Proyectos', icon: PanelsTopLeft, description: 'Briefs y fases' },
  { href: '/prompt-studio', label: 'Prompt Studio', icon: SquareTerminal, description: 'Generar y refinar' },
  { href: '/library', label: 'Landing Library', icon: BookMarked, description: 'Banco de paginas' },
  { href: '/technologies', label: 'Tecnologias', icon: Boxes, description: 'Stack y reglas' },
  { href: '/settings', label: 'Ajustes', icon: Settings, description: 'Proveedores de IA' },
];

export interface ShellInfo {
  displayName: string;
  email: string;
  storageMode: 'supabase' | 'local';
}

export function AppShell({ info, children }: { info: ShellInfo; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const { activeProviderId, providerStatuses } = useActiveProvider();
  const activeProviderStatus = providerStatuses.find((status) => status.id === activeProviderId);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[244px_1fr]">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
      >
        Saltar al contenido
      </a>

      {/* Barra superior en movil */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-panel px-3 py-2 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo />
          <span className="text-sm">AI Landing Studio</span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="nav-principal"
          className="inline-flex size-9 items-center justify-center border border-line-strong"
        >
          {menuOpen ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
          <span className="sr-only">{menuOpen ? 'Cerrar navegacion' : 'Abrir navegacion'}</span>
        </button>
      </header>

      {/* Navegacion lateral */}
      <nav
        id="nav-principal"
        aria-label="Navegacion principal"
        className={cn(
          'border-b border-line bg-panel lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r',
          'lg:flex lg:flex-col',
          menuOpen ? 'block' : 'hidden lg:block',
        )}
      >
        <div className="hidden items-center gap-2 border-b border-line px-4 py-3.5 lg:flex">
          <Logo />
          <span className="text-sm font-semibold tracking-tight">AI Landing Studio</span>
        </div>

        <div className="border-b border-line p-3">
          <GlobalSearch />
        </div>

        <ul className="flex-1 space-y-0.5 p-2">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-start gap-2.5 px-2.5 py-2 text-sm transition-colors',
                    active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel-2 hover:text-ink',
                  )}
                >
                  <Icon className="mt-0.5 size-4 flex-none" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium leading-tight">{item.label}</span>
                    <span className="block text-xs text-faint">{item.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="space-y-2 border-t border-line p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-faint">Almacenamiento</span>
            <span className="font-mono uppercase tracking-wider text-muted">
              {info.storageMode === 'supabase' ? 'Supabase' : 'Local'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-faint">Proveedor</span>
            <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider text-muted">
              <span
                className={cn('size-1.5 rounded-full', activeProviderStatus?.configured ? 'bg-ok' : 'bg-warn')}
                aria-hidden="true"
              />
              {activeProviderId}
            </span>
          </div>
          <div className="border-t border-line pt-2">
            <p className="truncate font-medium text-ink">{info.displayName}</p>
            <p className="truncate text-faint">{info.email}</p>
            <form action="/api/auth/logout" method="post" className="mt-2">
              <button type="submit" className="text-muted underline underline-offset-2 hover:text-ink">
                Cerrar sesion
              </button>
            </form>
          </div>
        </div>
      </nav>

      <main id="contenido" className="min-w-0">
        {children}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 flex-none place-items-center border border-ink bg-ink font-mono text-[0.625rem] font-bold text-bg"
    >
      AL
    </span>
  );
}
