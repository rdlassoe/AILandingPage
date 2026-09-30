'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointerClick,
  RotateCw,
  Smartphone,
  Tablet,
} from 'lucide-react';

import { parseFrameMessage } from '@/lib/preview/messages';
import { buildPreviewDocument } from '@/lib/preview/preview-document';
import type { SourceMap } from '@/lib/preview/instrument';
import { cn, formatBytes } from '@/lib/utils';
import { PREVIEW_NS } from '@/types/preview';
import type { InspectHit } from '@/types/preview';

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
 *
 * Inspector (opcional, `inspectable`): el padre no puede leer el DOM del
 * iframe, asi que al iframe se le carga una COPIA del documento con una marca
 * de posicion en cada etiqueta y un script que devuelve, por `postMessage`, que
 * elemento se pulso (`src/lib/preview/`). El prop `html` sigue siendo el HTML
 * limpio: es el que se abre en una pestana nueva y el que se mide.
 */

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: Array<{ id: Viewport; label: string; width: number; icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Escritorio', width: 1280, icon: Monitor },
  { id: 'tablet', label: 'Tablet', width: 768, icon: Tablet },
  { id: 'mobile', label: 'Movil', width: 390, icon: Smartphone },
];

const SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals';

type FrameCommand = { type: 'inspect'; on: boolean } | { type: 'highlight'; src: number | null };

interface PreviewDoc {
  srcDoc: string;
  map: SourceMap;
  rev: number;
}

export interface LandingPreviewProps {
  html: string;
  /** Muestra el indicador de generacion en curso. */
  generating?: boolean;
  title?: string;
  className?: string;
  /** Altura del area de preview cuando no esta en pantalla completa. */
  heightClassName?: string;
  /** Activa el inspector: el documento se carga instrumentado. */
  inspectable?: boolean;
  /** Modo inspeccion (controlado). Sin este prop el componente lo gestiona solo. */
  inspecting?: boolean;
  onInspectingChange?: (inspecting: boolean) => void;
  /** Clic en un elemento en modo inspeccion. `map` es el del render que se esta viendo. */
  onPick?: (hit: InspectHit, map: SourceMap) => void;
  /** Elemento a resaltar desde fuera (por ejemplo, el del cursor del editor). */
  highlightSrc?: number | null;
  /** No volver a pintar el velo "Cargando..." en cada recarga por una edicion. */
  quietUpdates?: boolean;
  /** Avisa del mapa del documento que se esta viendo (`null` si no hay). */
  onMapChange?: (map: SourceMap | null) => void;
}

export function LandingPreview({
  html,
  generating = false,
  title = 'Vista previa de la Landing Page',
  className,
  heightClassName = 'h-[clamp(420px,62vh,780px)]',
  inspectable = false,
  inspecting: inspectingProp,
  onInspectingChange,
  onPick,
  highlightSrc = null,
  quietUpdates = false,
  onMapChange,
}: LandingPreviewProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const [innerInspecting, setInnerInspecting] = useState(false);
  const inspecting = inspectable && (inspectingProp ?? innerInspecting);
  const [doc, setDoc] = useState<PreviewDoc | null>(null);
  const [inspectorFailed, setInspectorFailed] = useState(false);

  // Valores que los listeners y las promesas necesitan sin volver a registrarse.
  const docRef = useRef<PreviewDoc | null>(null);
  const revRef = useRef(0);
  const scrollRef = useRef(0);
  const hasLoadedOnce = useRef(false);
  const inspectingRef = useRef(inspecting);
  const highlightRef = useRef(highlightSrc);
  const onPickRef = useRef(onPick);
  const onMapChangeRef = useRef(onMapChange);
  const setInspectingRef = useRef<(on: boolean) => void>(() => undefined);

  const setInspecting = useCallback(
    (on: boolean) => {
      if (inspectingProp === undefined) setInnerInspecting(on);
      onInspectingChange?.(on);
    },
    [inspectingProp, onInspectingChange],
  );

  useEffect(() => {
    inspectingRef.current = inspecting;
    highlightRef.current = highlightSrc;
    onPickRef.current = onPick;
    onMapChangeRef.current = onMapChange;
    setInspectingRef.current = setInspecting;
  });

  const active = VIEWPORTS.find((item) => item.id === viewport) ?? VIEWPORTS[0]!;
  const sizeBytes = useMemo(() => new Blob([html]).size, [html]);
  const hasContent = html.trim().length > 0;

  /* ------------------------------------------------ documento instrumentado */

  useEffect(() => {
    if (!inspectable || !hasContent) {
      docRef.current = null;
      setDoc(null);
      onMapChangeRef.current?.(null);
      return;
    }

    let cancelled = false;
    revRef.current += 1;
    const rev = revRef.current;

    buildPreviewDocument(html, { rev, scrollY: scrollRef.current, inspecting: inspectingRef.current })
      .then((built) => {
        if (cancelled) return;
        const next = { ...built, rev };
        docRef.current = next;
        setDoc(next);
        setInspectorFailed(false);
        onMapChangeRef.current?.(built.map);
      })
      .catch(() => {
        if (cancelled) return;
        // Sin inspector, pero la pagina se sigue viendo.
        docRef.current = null;
        setDoc(null);
        setInspectorFailed(true);
        onMapChangeRef.current?.(null);
      });

    return () => {
      cancelled = true;
    };
    // `fullscreen` fuerza un documento nuevo con el scroll actual: el iframe se remonta.
  }, [html, inspectable, hasContent, reloadKey, fullscreen]);

  // Con el inspector disponible no se carga nada hasta tener el documento
  // instrumentado (evita cargar primero el limpio y recargar al segundo).
  const srcDoc = !inspectable || inspectorFailed ? html : (doc?.srcDoc ?? null);

  useEffect(() => {
    if (quietUpdates && hasLoadedOnce.current) return;
    setLoaded(false);
  }, [srcDoc, reloadKey, quietUpdates]);

  /* ---------------------------------------------------- mensajes del iframe */

  const post = useCallback((command: FrameCommand) => {
    frameRef.current?.contentWindow?.postMessage({ ns: PREVIEW_NS, ...command }, '*');
  }, []);

  useEffect(() => {
    if (!inspectable) return;

    const onMessage = (event: MessageEvent) => {
      const current = docRef.current;
      // Solo se acepta lo que viene de NUESTRO iframe y del render actual.
      if (!current || event.source !== frameRef.current?.contentWindow) return;
      const message = parseFrameMessage(event.data, current.rev, current.map.source.length);
      if (!message) return;

      switch (message.type) {
        case 'ready':
          // Cubre los cambios hechos mientras el documento todavia cargaba.
          post({ type: 'inspect', on: inspectingRef.current });
          post({ type: 'highlight', src: highlightRef.current });
          break;
        case 'pick':
          onPickRef.current?.(message.hit, current.map);
          break;
        case 'exit':
          setInspectingRef.current(false);
          break;
        case 'scroll':
          scrollRef.current = message.y;
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [inspectable, post]);

  useEffect(() => {
    if (inspectable && doc) post({ type: 'inspect', on: inspecting });
  }, [inspecting, inspectable, doc, post]);

  useEffect(() => {
    if (inspectable && doc) post({ type: 'highlight', src: highlightSrc });
  }, [highlightSrc, inspectable, doc, post]);

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
    // Siempre el HTML limpio, sin las marcas ni el script del inspector.
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    // Se revoca con retraso para que el navegador llegue a cargar el documento.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [html]);

  const reload = () => {
    hasLoadedOnce.current = false;
    setLoaded(false);
    setReloadKey((key) => key + 1);
  };

  const frame = (
    <div
      className={cn(
        'relative overflow-auto bg-panel-2 p-3',
        // Con `flex-1` (base 0%) en un contenedor de altura indefinida, `height`
        // se ignora y el marco queda del tamano de su contenido (~176px). Solo
        // en pantalla completa el contenedor tiene altura definida.
        fullscreen ? 'h-[calc(100dvh-49px)] flex-1' : cn('flex-none', heightClassName),
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
          {srcDoc !== null ? (
            <iframe
              key={reloadKey}
              ref={frameRef}
              title={title}
              srcDoc={srcDoc}
              sandbox={SANDBOX}
              referrerPolicy="no-referrer"
              loading="lazy"
              onLoad={() => {
                hasLoadedOnce.current = true;
                setLoaded(true);
              }}
              className="size-full border-0 bg-white"
            />
          ) : null}
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
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Tamano de pantalla">
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

        {inspectable ? (
          <>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setInspecting(!inspecting)}
              aria-pressed={inspecting}
              disabled={!hasContent || inspectorFailed}
              title={
                inspectorFailed
                  ? 'El inspector no pudo cargarse'
                  : 'Inspeccionar: haz clic en un elemento para ir a su codigo'
              }
              className={cn(
                'inline-flex h-8 items-center gap-1.5 border px-2 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40',
                inspecting
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-transparent text-muted hover:bg-panel-2 hover:text-ink',
              )}
            >
              <MousePointerClick className="size-3.5" aria-hidden="true" />
              Inspeccionar
            </button>
            {inspecting ? (
              <span className="hidden text-xs text-muted md:inline" role="status">
                Haz clic en un elemento &middot; Esc para salir
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <span className="mr-1 hidden font-mono text-[0.6875rem] uppercase tracking-wider text-faint sm:inline">
          {active.width}px &middot; {formatBytes(sizeBytes)}
        </span>
        <IconButton label="Recargar vista previa" onClick={reload} disabled={!hasContent}>
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
