'use client';

import { useRouter } from 'next/navigation';

import { HtmlCodeEditor } from '@/components/editor/html-code-editor.lazy';
import { LandingPreview } from '@/components/preview/landing-preview';
import { Panel } from '@/components/ui';
import type { LandingPage } from '@/types/domain';
import { EditorAlerts, EditorToolbar } from './editor-controls';
import { InspectorPanel } from './inspector-panel';
import { useDebouncedValue } from './use-debounced-value';
import { useInspectorSync } from './use-inspector-sync';
import { useLandingEditor } from './use-landing-editor';

const EDITOR_HEIGHT = 'h-[clamp(420px,68vh,820px)]';

/**
 * Pantalla de edicion de una Landing Page: codigo a la izquierda, vista previa
 * con inspector a la derecha.
 *
 * La vista previa se actualiza con un pequeno retraso tras dejar de escribir,
 * y conserva el scroll. Nada de lo escrito es definitivo hasta pulsar
 * "Guardar" (ver `useLandingEditor`).
 */
export function CodeWorkbench({ landing }: { landing: LandingPage }) {
  const router = useRouter();

  // `landing` es la del servidor: tras guardar, `router.refresh()` la renueva.
  const editor = useLandingEditor(landing, { onSaved: () => router.refresh() });
  const previewHtml = useDebouncedValue(editor.draft, 400);
  const sync = useInspectorSync({ text: editor.draft });

  return (
    <div className="grid gap-4">
      <EditorAlerts editor={editor} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="flex min-w-0 flex-col">
          <EditorToolbar editor={editor} cursor={sync.cursor} onGoto={sync.openGotoLine} />
          <HtmlCodeEditor
            value={editor.draft}
            onChange={editor.setDraft}
            onSave={() => void editor.save()}
            label={`Codigo HTML de ${landing.name}`}
            className={EDITOR_HEIGHT}
            {...sync.editorProps}
          />
          <p className="border-t border-line px-3 py-2 text-xs text-muted">
            Ctrl+S guarda una version nueva &middot; Ctrl+F busca &middot; Ctrl+Alt+G va a una linea &middot; Esc y
            luego Tab sacan el foco del editor.
          </p>
        </Panel>

        <div className="grid min-w-0 content-start gap-4">
          <LandingPreview
            html={previewHtml}
            title={`Vista previa de ${landing.name}`}
            heightClassName={EDITOR_HEIGHT}
            {...sync.previewProps}
          />
          <InspectorPanel sync={sync} />
        </div>
      </div>
    </div>
  );
}
