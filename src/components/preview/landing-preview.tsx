'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Maximize2, Minimize2, Monitor, RotateCw, Smartphone, Tablet } from 'lucide-react';

import { cn, formatBytes } from '@/lib/utils';

/**
 * Preview Engine
 *
 * Renderiza la Landing Page generada dentro de un iframe aislado mediante
 * `srcDoc`. Nunca se usa `dangerouslySetInnerHTML`: el documento generado no
 * comparte DOM ni origen con la aplicacion.
 *
 * Aislamiento: el atributo `sandbox` NO incluye `allow-same-origin`, de modo
 * que el iframe se ejecuta en un origen opaco. El HTML generado puede correr
 * su propio JavaScript (menus, acordeones, validacion de formularios) pero no
 * puede leer cookies, `localStorage` ni tocar la ventana padre.
 */

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: Array<{ id: Viewport; label: string; width: number; icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Escritorio', width: 1280, icon: Monitor },
  { id: 'tablet', label: 'Tablet', width: 768, icon: Tablet },
  { id: 'mobile', label: 'Movil', width: 390, icon: Smartphone },
];

const SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals';

export interface LandingPreviewProps {
  html: string;
  /** Muestra el indicador de generacion en curso. */
  generating?: boolean;
  title?: string;
  className?: string;
  /** Altura del area de preview cuando no esta en pantalla completa. */
  heightClassName?: string;
}

export function LandingPreview({
  html,
  generating = false,
  title = 'Vista previa de la Landing Page',
  className,
  heightClassName = 'h-[clamp(420px,62vh,780px)]',
}: LandingPreviewProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const active = VIEWPORTS.find((item) => item.id === viewport) ?? VIEWPORTS[0]!;
  const sizeBytes = useMemo(() => new Blob([html]).size, [html]);

  useEffect(() => {
    setLoaded(false);
  }, [html, reloadKey]);

  // Escape sale de pantalla completa
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [fullscreen]);

  const openInNewTab = useCallback(() => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    // Se revoca con retraso para que el navegador llegue a cargar el documento.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [html]);

  const hasContent = html.trim().length > 0;

  const frame = (
    <div
      className={cn(
        'relative flex-1 overflow-auto bg-panel-2 p-3',
        fullscreen ? 'h-[calc(100dvh-49px)]' : heightClassName,
      )}
    >
      {!hasContent ? (
        <div className="grid h-full place-items-center px-6 text-center">
          <p className="max-w-sm text-sm text-muted">
            Todavia no hay nada que previsualizar. Genera una Landing Page para verla aqui.
          </p>
        </div>
      ) : (
        <div
          className="mx-auto h-full border border-line bg-white transition-[max-width] duration-200"
          style={{ maxWidth: active.width }}
        >
          <iframe
            key={reloadKey}
            ref={frameRef}
            title={title}
            srcDoc={html}
            sandbox={SANDBOX}
            referrerPolicy="no-referrer"
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className="size-full border-0 bg-white"
          />
        </div>
      )}

      {(generating || (hasContent && !loaded)) && (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center bg-panel-2/80"
          role="status"
          aria-live="polite"
        >
          <span className="inline-flex items-center gap-2 border border-line bg-panel px-3 py-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {generating ? 'Generando Landing Page...' : 'Cargando vista previa...'}
          </span>
        </div>
      )}
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel px-3 py-2">
      <div className="flex items-center gap-1" role="group" aria-label="Tamano de pantalla">
        {VIEWPORTS.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === viewport;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setViewport(item.id)}
              aria-pressed={isActive}
              title={`${item.label} (${item.width}px)`}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 border px-2 text-xs transition-colors',
                isActive
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-transparent text-muted hover:bg-panel-2 hover:text-ink',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1">
        <span className="mr-1 hidden font-mono text-[0.6875rem] uppercase tracking-wider text-faint sm:inline">
          {active.width}px &middot; {formatBytes(sizeBytes)}
        </span>
        <IconButton label="Recargar vista previa" onClick={() => setReloadKey((key) => key + 1)} disabled={!hasContent}>
          <RotateCw className="size-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton label="Abrir en una pestana nueva" onClick={openInNewTab} disabled={!hasContent}>
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton
          label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          onClick={() => setFullscreen((value) => !value)}
          disabled={!hasContent}
        >
          {fullscreen ? (
            <Minimize2 className="size-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="size-3.5" aria-hidden="true" />
          )}
        </IconButton>
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={title}>
        {toolbar}
        {frame}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col border border-line bg-panel', className)}>
      {toolbar}
      {frame}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="inline-flex size-8 items-center justify-center border border-transparent text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
