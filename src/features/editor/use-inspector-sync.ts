'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HtmlCursor, HtmlEditorApi } from '@/components/editor/html-code-editor.lazy';
import type { LandingPreviewProps } from '@/components/preview/landing-preview';
import { findEntryAt, lineColAt, type SourceEntry, type SourceMap } from '@/lib/preview/instrument';
import type { InspectHit } from '@/types/preview';

/**
 * Une el inspector de la vista previa con el editor de codigo.
 *
 *   clic en la pagina   ->  el editor salta a la etiqueta de ese elemento
 *   cursor en el editor ->  la pagina resalta el elemento bajo el cursor
 *
 * Las posiciones que devuelve el inspector se refieren al texto con el que se
 * construyo la vista previa (`map.source`). Como esta va con un pequeno retraso
 * respecto a lo que se escribe, solo se salta si ese texto coincide con el del
 * editor: si no, la posicion podria caer en otra linea y es mejor avisar.
 */

export interface InspectorSelection {
  hit: InspectHit;
  /** Posicion de la etiqueta seleccionada (la del elemento o la de un ancestro elegido). */
  activeSrc: number;
  entry: SourceEntry;
  line: number;
  col: number;
}

export interface InspectorSync {
  inspecting: boolean;
  setInspecting: (on: boolean) => void;
  selection: InspectorSelection | null;
  notice: string | null;
  cursor: HtmlCursor | null;
  /** Salta a la etiqueta de un elemento del `chain` (los ancestros del panel). */
  revealSrc: (src: number) => void;
  /** Abre el cuadro "Ir a la linea" del editor. */
  openGotoLine: () => void;
  /** Propiedades a repartir en `LandingPreview`. */
  previewProps: Pick<
    LandingPreviewProps,
    | 'inspectable'
    | 'inspecting'
    | 'onInspectingChange'
    | 'onPick'
    | 'highlightSrc'
    | 'onMapChange'
    | 'quietUpdates'
  >;
  /** Propiedades a repartir en el editor. */
  editorProps: { onReady: (api: HtmlEditorApi | null) => void; onCursor: (cursor: HtmlCursor) => void };
}

export function useInspectorSync(options: {
  /** Texto actual del editor (con `\n`). */
  text: string;
  /** Se llama tras pedir un salto: el Prompt Studio cambia a la pestana del codigo. */
  onReveal?: () => void;
}): InspectorSync {
  const { text, onReveal } = options;

  const [inspecting, setInspecting] = useState(false);
  const [map, setMap] = useState<SourceMap | null>(null);
  const [selection, setSelection] = useState<InspectorSelection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cursor, setCursor] = useState<HtmlCursor | null>(null);
  const [highlightSrc, setHighlightSrc] = useState<number | null>(null);

  const apiRef = useRef<HtmlEditorApi | null>(null);
  // Si el editor aun no esta montado (pestana cerrada, chunk cargando), el salto espera.
  const pendingReveal = useRef<{ from: number; to: number } | null>(null);
  const textRef = useRef(text);
  const onRevealRef = useRef(onReveal);
  useEffect(() => {
    textRef.current = text;
    onRevealRef.current = onReveal;
  });

  const reveal = useCallback((from: number, to: number) => {
    onRevealRef.current?.();
    if (apiRef.current) {
      apiRef.current.reveal(from, to);
    } else {
      pendingReveal.current = { from, to };
    }
  }, []);

  const onReady = useCallback((api: HtmlEditorApi | null) => {
    apiRef.current = api;
    if (!api || !pendingReveal.current) return;

    // En desarrollo React monta el editor, lo desmonta y lo vuelve a montar (StrictMode),
    // todo en el mismo commit. Si el salto se aplicara ya, caeria en la instancia que
    // se destruye a continuacion. Se espera al final del commit y solo se aplica (y se
    // consume) si este montaje sigue siendo el vigente.
    queueMicrotask(() => {
      const pending = pendingReveal.current;
      if (!pending || apiRef.current !== api) return;
      pendingReveal.current = null;
      api.reveal(pending.from, pending.to);
    });
  }, []);

  const select = useCallback(
    (hit: InspectHit, activeSrc: number, source: SourceMap) => {
      const entry = source.byStart.get(activeSrc);
      if (!entry) {
        setNotice('No se pudo ubicar ese elemento en el codigo.');
        return;
      }
      const { line, col } = lineColAt(source.source, entry.start);
      setSelection({ hit, activeSrc, entry, line, col });
      setNotice(null);
      reveal(entry.start, entry.tagEnd);
    },
    [reveal],
  );

  const onPick = useCallback<NonNullable<LandingPreviewProps['onPick']>>(
    (hit, source) => {
      if (hit.src === null) {
        setNotice('No se pudo ubicar ese elemento en el codigo.');
        return;
      }
      // La vista previa va un instante por detras de lo que se escribe.
      if (source.source !== textRef.current) {
        setNotice('La vista previa se estaba actualizando con tus cambios. Espera un momento y vuelve a pulsar.');
        return;
      }
      select(hit, hit.src, source);
    },
    [select],
  );

  const revealSrc = useCallback(
    (src: number) => {
      if (!map || !selection || map.source !== textRef.current) return;
      select(selection.hit, src, map);
    },
    [map, selection, select],
  );

  const onCursor = useCallback((next: HtmlCursor) => setCursor(next), []);
  const openGotoLine = useCallback(() => apiRef.current?.openGotoLine(), []);

  // Elemento bajo el cursor -> resalte en la pagina. Con retraso para no competir con cada tecla.
  useEffect(() => {
    if (!map || !cursor || map.source !== text) {
      setHighlightSrc(null);
      return;
    }
    const timer = setTimeout(() => setHighlightSrc(findEntryAt(map, cursor.pos)?.start ?? null), 150);
    return () => clearTimeout(timer);
  }, [map, cursor, text]);

  // Si el texto renderizado cambia, las posiciones guardadas se desplazan y la seleccion
  // dejaria de describir el elemento correcto. Recargar el mismo texto (pantalla completa,
  // boton recargar) no la invalida.
  const mapSource = useRef<string | null>(null);
  useEffect(() => {
    const source = map?.source ?? null;
    if (source === mapSource.current) return;
    mapSource.current = source;
    setSelection(null);
  }, [map]);

  const previewProps = useMemo<InspectorSync['previewProps']>(
    () => ({
      inspectable: true,
      inspecting,
      onInspectingChange: setInspecting,
      onPick,
      highlightSrc,
      onMapChange: setMap,
      quietUpdates: true,
    }),
    [inspecting, onPick, highlightSrc],
  );

  return {
    inspecting,
    setInspecting,
    selection,
    notice,
    cursor,
    revealSrc,
    openGotoLine,
    previewProps,
    editorProps: { onReady, onCursor },
  };
}
