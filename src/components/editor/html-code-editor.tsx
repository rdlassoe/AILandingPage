'use client';

import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab, temporarilySetTabFocusMode } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { gotoLine, highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { cn } from '@/lib/utils';

/**
 * Editor de codigo HTML (CodeMirror 6).
 *
 * Cargar solo a traves de `html-code-editor.lazy.tsx`: CodeMirror pesa cientos
 * de KB y solo hace falta en las pantallas de edicion, nunca en el servidor.
 *
 * El documento que expone usa siempre `\n`, aunque el texto llegue con `\r\n`;
 * quien lo alimente debe normalizarlo antes (`normalizeEol`) para que las
 * posiciones del inspector coincidan con las del editor.
 */

export interface HtmlCursor {
  /** Posicion (UTF-16) desde el inicio del documento. */
  pos: number;
  line: number;
  col: number;
}

export interface HtmlEditorApi {
  /** Selecciona el rango, lo centra en pantalla y lo resalta un instante. */
  reveal: (from: number, to: number) => void;
  /** Abre el cuadro "Ir a la linea". */
  openGotoLine: () => void;
  focus: () => void;
}

export interface HtmlCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCursor?: (cursor: HtmlCursor) => void;
  /** Ctrl/Cmd + S. */
  onSave?: () => void;
  /** Entrega la API imperativa al montar y `null` al desmontar. */
  onReady?: (api: HtmlEditorApi | null) => void;
  /** Nombre accesible del area de edicion. */
  label: string;
  className?: string;
}

/** Marca un rango unos instantes; el fundido lo define `.cm-ale-flash` en globals.css. */
const flashEffect = StateEffect.define<{ from: number; to: number } | null>();

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(flashEffect)) continue;
      const range = effect.value;
      next =
        range && range.to > range.from
          ? Decoration.set([Decoration.mark({ class: 'cm-ale-flash' }).range(range.from, range.to)])
          : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Colores con las variables del tema de la app: cambian solos en modo oscuro. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.tagName, color: 'var(--accent)' },
  { tag: tags.angleBracket, color: 'var(--muted)' },
  { tag: tags.attributeName, color: 'var(--warn)' },
  { tag: [tags.attributeValue, tags.string], color: 'var(--ok)' },
  // `--muted` y no `--faint`: sobre el fondo del editor, `--faint` queda por debajo de 4,5:1 en modo oscuro.
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.documentMeta, tags.processingInstruction], color: 'var(--muted)' },
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword],
    color: 'var(--accent)',
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit, tags.color], color: 'var(--warn)' },
  { tag: [tags.propertyName, tags.labelName], color: 'var(--accent)' },
  { tag: [tags.className, tags.constant(tags.name)], color: 'var(--warn)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--bg)',
    color: 'var(--ink)',
    fontSize: '12px',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--panel-2)',
    color: 'var(--muted)',
    border: 'none',
    borderRight: '1px solid var(--line)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' },
  '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 34%, transparent)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 22%, transparent)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { outline: '1px solid var(--line-strong)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--panel-2)',
    border: '1px solid var(--line-strong)',
    color: 'var(--muted)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--panel)',
    color: 'var(--ink)',
    borderColor: 'var(--line)',
  },
  '.cm-panels input, .cm-panels button, .cm-panels select': {
    backgroundColor: 'var(--bg)',
    color: 'var(--ink)',
    border: '1px solid var(--line-strong)',
    borderRadius: '0',
    backgroundImage: 'none',
  },
  '.cm-panels input:focus-visible, .cm-panels button:focus-visible': {
    outline: '2px solid var(--accent)',
    outlineOffset: '1px',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 28%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 38%, transparent)' },
});

export function HtmlCodeEditor({ value, onChange, onCursor, onSave, onReady, label, className }: HtmlCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Lo que el editor ya conoce: evita devolverle su propio texto como si fuera una edicion externa.
  const lastEmitted = useRef(value);
  const initial = useRef({ value, label });
  const callbacks = useRef({ onChange, onCursor, onSave, onReady });

  useEffect(() => {
    callbacks.current = { onChange, onCursor, onSave, onReady };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          html(),
          syntaxHighlighting(highlightStyle),
          theme,
          flashField,
          EditorView.contentAttributes.of({ 'aria-label': initial.current.label, spellcheck: 'false' }),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                callbacks.current.onSave?.();
                return true;
              },
            },
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
            // Tab sangra, asi que sin esto el teclado no podria salir del editor.
            { key: 'Escape', run: temporarilySetTabFocusMode },
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const text = update.state.doc.toString();
              lastEmitted.current = text;
              callbacks.current.onChange(text);
            }
            if (update.docChanged || update.selectionSet) {
              const pos = update.state.selection.main.head;
              const line = update.state.doc.lineAt(pos);
              callbacks.current.onCursor?.({ pos, line: line.number, col: pos - line.from + 1 });
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    const api: HtmlEditorApi = {
      reveal: (from, to) => {
        const length = view.state.doc.length;
        const start = Math.min(Math.max(from, 0), length);
        const end = Math.min(Math.max(to, start), length);

        if (flashTimer) clearTimeout(flashTimer);
        view.dispatch({
          selection: EditorSelection.range(start, end),
          effects: [EditorView.scrollIntoView(start, { y: 'center', x: 'nearest' }), flashEffect.of({ from: start, to: end })],
        });
        view.focus();
        flashTimer = setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 1500);
      },
      openGotoLine: () => {
        view.focus();
        gotoLine(view);
      },
      focus: () => view.focus(),
    };
    callbacks.current.onReady?.(api);

    return () => {
      if (flashTimer) clearTimeout(flashTimer);
      callbacks.current.onReady?.(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Cambios que vienen de fuera (descartar, recargar tras guardar): se vuelcan en el editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastEmitted.current) return;
    lastEmitted.current = value;
    if (view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  return <div ref={hostRef} className={cn('min-h-0 border border-line bg-bg', className)} />;
}
