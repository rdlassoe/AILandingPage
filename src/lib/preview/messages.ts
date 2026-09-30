import type { InspectChainItem, InspectHit, PreviewFromFrame, PREVIEW_NS } from '@/types/preview';

/**
 * Validacion de los mensajes que llegan del iframe.
 *
 * El documento generado por el modelo corre en ese mismo iframe y puede llamar
 * a `parent.postMessage` igual que el inspector, asi que nada de lo recibido se
 * da por bueno: solo se aceptan mensajes del render actual (`rev`), con
 * posiciones enteras dentro del texto fuente y cadenas acotadas. Los textos se
 * muestran siempre como texto, nunca como HTML.
 *
 * Solo importa tipos (nada en tiempo de ejecucion) para que
 * `scripts/verify-inspector.mjs` pueda ejecutarlo con Node. El tipo literal
 * hace que el compilador avise si este valor deja de coincidir con
 * `PREVIEW_NS`.
 */
const NS: typeof PREVIEW_NS = 'ale';

type Record_ = Record<string, unknown>;

const isRecord = (value: unknown): value is Record_ => typeof value === 'object' && value !== null && !Array.isArray(value);

const TAG = /^[a-z][a-z0-9:_-]{0,39}$/i;

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function position(value: unknown, sourceLength: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < sourceLength ? value : null;
}

function classes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list: string[] = [];
  for (const item of value.slice(0, 8)) {
    const name = text(item, 80);
    if (name === null) return null;
    list.push(name);
  }
  return list;
}

function tag(value: unknown): string | null {
  return typeof value === 'string' && TAG.test(value) ? value.toLowerCase() : null;
}

function size(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(Math.min(value, 100_000)) : null;
}

function chainItem(value: unknown, sourceLength: number): InspectChainItem | null {
  if (!isRecord(value)) return null;
  const src = position(value.src, sourceLength);
  const name = tag(value.tag);
  const id = text(value.id, 120);
  const list = classes(value.classes);
  if (src === null || name === null || id === null || list === null) return null;
  return { src, tag: name, id, classes: list };
}

function hit(value: unknown, sourceLength: number): InspectHit | null {
  if (!isRecord(value)) return null;

  const src = value.src === null ? null : position(value.src, sourceLength);
  if (value.src !== null && src === null) return null;

  const name = tag(value.tag);
  const id = text(value.id, 120);
  const list = classes(value.classes);
  const visible = text(value.text, 200);
  const width = size(value.width);
  const height = size(value.height);
  if (name === null || id === null || list === null || visible === null || width === null || height === null) return null;
  if (typeof value.dynamic !== 'boolean' || !Array.isArray(value.chain)) return null;

  const chain: InspectChainItem[] = [];
  for (const item of value.chain.slice(0, 40)) {
    const parsed = chainItem(item, sourceLength);
    if (parsed) chain.push(parsed);
  }

  return { src, dynamic: value.dynamic, tag: name, id, classes: list, text: visible, width, height, chain };
}

/**
 * Devuelve el mensaje ya validado, o `null` si no es del inspector, es de otro
 * render, o trae datos fuera de rango.
 */
export function parseFrameMessage(data: unknown, expectedRev: number, sourceLength: number): PreviewFromFrame | null {
  if (!isRecord(data) || data.ns !== NS || data.rev !== expectedRev) return null;

  switch (data.type) {
    case 'ready':
      return { type: 'ready' };
    case 'exit':
      return { type: 'exit' };
    case 'scroll':
      return typeof data.y === 'number' && Number.isFinite(data.y)
        ? { type: 'scroll', y: Math.min(Math.max(data.y, 0), 10_000_000) }
        : null;
    case 'pick': {
      const parsed = hit(data.hit, sourceLength);
      return parsed ? { type: 'pick', hit: parsed } : null;
    }
    default:
      return null;
  }
}
