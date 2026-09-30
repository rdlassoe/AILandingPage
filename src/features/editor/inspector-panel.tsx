'use client';

import { CornerDownRight, MousePointerClick } from 'lucide-react';

import { Alert, Button, Panel, PanelBody, PanelHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { InspectChainItem } from '@/types/preview';
import type { InspectorSync } from './use-inspector-sync';

const describe = (item: Pick<InspectChainItem, 'tag' | 'id' | 'classes'>, classLimit = 2) =>
  `${item.tag}${item.id ? `#${item.id}` : ''}${item.classes
    .slice(0, classLimit)
    .map((name) => `.${name}`)
    .join('')}`;

/** Elemento elegido en la vista previa y su posicion en el codigo. */
export function InspectorPanel({ sync }: { sync: InspectorSync }) {
  const { selection, notice } = sync;

  // `min-w-0` y `break-all`: los id y las clases vienen del HTML de la pagina y pueden ser
  // cadenas largas sin espacios (Tailwind con variantes arbitrarias, BEM largo...). Sin
  // ellos, el panel ensancha su columna de la cuadricula y toda la pagina gana scroll horizontal.
  return (
    <Panel className="min-w-0">
      <PanelHeader
        eyebrow="Inspector"
        title={
          selection ? <span className="break-all">{`<${describe(selection.hit, 3)}>`}</span> : 'Ningun elemento elegido'
        }
        description={
          selection
            ? `Linea ${selection.line}, columna ${selection.col} del codigo`
            : 'Activa "Inspeccionar" en la vista previa y haz clic en un elemento: el editor salta a su etiqueta.'
        }
        actions={
          selection ? (
            <Button size="sm" onClick={() => sync.revealSrc(selection.activeSrc)}>
              <CornerDownRight className="size-3.5" aria-hidden="true" />
              Ir a la linea {selection.line}
            </Button>
          ) : (
            <MousePointerClick className="size-4 text-faint" aria-hidden="true" />
          )
        }
      />

      {notice || selection ? (
        <PanelBody className="grid gap-3">
          {notice ? <Alert tone="warn">{notice}</Alert> : null}

          {selection ? (
            <>
              {selection.hit.dynamic ? (
                <Alert tone="info">
                  Ese elemento lo crea el JavaScript de la pagina y no esta en el codigo. Se muestra el ancestro mas
                  cercano que si esta.
                </Alert>
              ) : null}

              <p className="font-mono text-xs text-muted [overflow-wrap:anywhere]">
                {selection.hit.width} &times; {selection.hit.height} px
                {selection.hit.text ? ` · "${selection.hit.text}"` : ''}
              </p>

              {selection.hit.chain.length > 1 ? (
                <nav aria-label="Ancestros del elemento">
                  <p className="eyebrow mb-1.5">Ancestros</p>
                  <ol className="flex flex-wrap items-center gap-1">
                    {[...selection.hit.chain].reverse().map((item) => {
                      const active = item.src === selection.activeSrc;
                      return (
                        <li key={item.src} className="min-w-0 max-w-full">
                          <button
                            type="button"
                            onClick={() => sync.revealSrc(item.src)}
                            aria-current={active ? 'true' : undefined}
                            className={cn(
                              'max-w-full break-all border px-1.5 py-0.5 text-left font-mono text-[0.6875rem] transition-colors',
                              active
                                ? 'border-accent bg-accent-soft text-accent'
                                : 'border-line text-muted hover:bg-panel-2 hover:text-ink',
                            )}
                          >
                            {describe(item, 1)}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              ) : null}
            </>
          ) : null}
        </PanelBody>
      ) : null}
    </Panel>
  );
}
