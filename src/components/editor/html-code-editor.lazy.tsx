'use client';

import dynamic from 'next/dynamic';

import { cn } from '@/lib/utils';

/**
 * Carga diferida del editor: CodeMirror solo se descarga al abrir una pantalla
 * de edicion y nunca se renderiza en el servidor.
 */
export const HtmlCodeEditor = dynamic(() => import('./html-code-editor').then((module) => module.HtmlCodeEditor), {
  ssr: false,
  loading: () => (
    <div
      className={cn('grid min-h-40 place-items-center border border-line bg-bg text-sm text-muted')}
      role="status"
      aria-live="polite"
    >
      Cargando editor...
    </div>
  ),
});

export type { HtmlCursor, HtmlEditorApi, HtmlCodeEditorProps } from './html-code-editor';
