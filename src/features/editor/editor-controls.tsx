'use client';

import { Hash, Save, Undo2 } from 'lucide-react';

import type { HtmlCursor } from '@/components/editor/html-code-editor.lazy';
import { Alert, Badge, Button } from '@/components/ui';
import type { LandingEditorState } from './use-landing-editor';

/** Barra del editor: estado de guardado, posicion del cursor y acciones. */
export function EditorToolbar({
  editor,
  cursor,
  onGoto,
}: {
  editor: LandingEditorState;
  cursor: HtmlCursor | null;
  onGoto: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {editor.dirty ? (
          <Badge tone="warn">cambios sin guardar</Badge>
        ) : (
          <Badge tone="ok">guardado &middot; v{editor.savedVersion}</Badge>
        )}
        <span className="font-mono text-xs text-muted" aria-live="off">
          {cursor ? `Linea ${cursor.line}:${cursor.col}` : 'Linea -'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={onGoto} title="Ir a la linea (Ctrl+Alt+G)">
          <Hash className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Ir a la linea</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={editor.discard} disabled={!editor.dirty || editor.saving}>
          <Undo2 className="size-3.5" aria-hidden="true" />
          Descartar
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void editor.save()}
          loading={editor.saving}
          disabled={!editor.dirty}
          title="Guardar como una version nueva (Ctrl+S)"
        >
          <Save className="size-3.5" aria-hidden="true" />
          Guardar
        </Button>
      </div>
    </div>
  );
}

/** Avisos del editor: conflicto, error, borrador recuperado y resultado del ultimo guardado. */
export function EditorAlerts({ editor }: { editor: LandingEditorState }) {
  const { lastSave, issues } = editor;
  const savedNotice = lastSave && !editor.dirty && !editor.error && !editor.conflict;

  return (
    <>
      {editor.conflict ? (
        <Alert
          tone="warn"
          title="La pagina cambio mientras la editabas"
          actions={
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => void editor.loadLatest()}>
                Cargar la ultima
              </Button>
              <Button size="sm" onClick={() => void editor.keepMine()}>
                Conservar mi texto
              </Button>
            </div>
          }
        >
          Otra accion (un refinamiento, otra pestana) creo una version nueva. &quot;Cargar la ultima&quot; descarta
          tu texto; &quot;Conservar mi texto&quot; lo deja listo para guardarse como la version siguiente, y la
          anterior sigue en el historial.
        </Alert>
      ) : null}

      {editor.error && !editor.conflict ? <Alert tone="danger">{editor.error}</Alert> : null}

      {editor.restored && editor.dirty ? (
        <Alert
          tone="info"
          title="Recuperamos cambios sin guardar"
          actions={
            <Button size="sm" onClick={editor.discard}>
              Descartarlos
            </Button>
          }
        >
          Son de tu sesion anterior y siguen sin guardarse: hasta que pulses Guardar no forman parte de la pagina.
        </Alert>
      ) : null}

      {savedNotice ? (
        <Alert tone="ok" title={lastSave.changed ? `Version v${lastSave.version} guardada` : 'Sin cambios'}>
          {lastSave.changed
            ? 'Es la version vigente: la ficha, la descarga y el critico ya usan este HTML.'
            : 'El HTML es identico al guardado; no se creo ninguna version nueva.'}
        </Alert>
      ) : null}

      {savedNotice && issues.length > 0 ? (
        <Alert tone="warn" title="Guardado con avisos">
          <ul className="grid gap-0.5">
            {issues.map((issue) => (
              <li key={issue.code}>&middot; {issue.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </>
  );
}
