import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Cabecera estandar de pagina: contexto arriba, acciones a la derecha. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-4 border-b border-line bg-panel px-4 py-5 sm:px-6',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Contenedor con el ancho y el espaciado estandar del contenido. */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('space-y-5 px-4 py-6 sm:px-6', className)}>{children}</div>;
}
