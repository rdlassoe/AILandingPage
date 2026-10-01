import type { DefaultTreeAdapterMap } from 'parse5';

/**
 * Marcadores de imagen del HTML generado.
 *
 * Con la tecnica "Generacion de imagenes" el LLM deja, donde quiere una imagen,
 * un `<img data-ai-image="prompt en ingles" alt="..." ...>` SIN `src`. Despues
 * de validar la salida, el servidor genera cada imagen y rellena el `src` con
 * una URL corta (`/api/landing-images/<uuid>`). Si una imagen no se puede
 * generar, el marcador se queda con un bloque neutro y un comentario con su
 * prompt, y se puede reintentar mas tarde.
 *
 * El HTML es el UNICO estado: un marcador esta "pendiente" cuando su `src` no
 * apunta a `/api/landing-images/`. No hay tabla de tareas.
 *
 * Como en `src/lib/preview/instrument.ts`, las ediciones se hacen por empalme de
 * cadena sobre las posiciones de `parse5` y nunca re-serializando el arbol:
 * serializar cambiaria el formato del HTML que el usuario ve en el editor.
 *
 * Sin dependencias del proyecto (ni el alias `@/`) para que
 * `scripts/verify-images.mjs` pueda ejecutarlo directamente con Node.
 */

type ParseNode = DefaultTreeAdapterMap['node'];
type ParseElement = DefaultTreeAdapterMap['element'];

export const IMAGE_ATTR = 'data-ai-image';
export const IMAGE_ROUTE_PREFIX = '/api/landing-images/';
export const PENDING_COMMENT_LABEL = 'IMAGEN PENDIENTE';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const READY_SRC = new RegExp(`^${IMAGE_ROUTE_PREFIX}${UUID}$`, 'i');
const UUID_ONLY = new RegExp(`^${UUID}$`, 'i');

/** Bloque neutro que ocupa el sitio de una imagen que todavia no existe. */
export const PLACEHOLDER_SRC =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" preserveAspectRatio="none">' +
      '<rect width="4" height="4" fill="#d8d5ce"/></svg>',
  );

export type SlotState = 'ready' | 'pending';

export interface ImageSlot {
  /** Orden de documento, desde 0. */
  index: number;
  /** Posicion (UTF-16) del `<` de la etiqueta `<img>`. */
  start: number;
  /** Posicion justo despues del `>` de la etiqueta. */
  end: number;
  /** Valor de `data-ai-image`: el prompt para el generador. */
  prompt: string;
  alt: string;
  /** `src` actual, o `null` si no lo tiene. */
  src: string | null;
  state: SlotState;
  /** Posicion y longitud del atributo `src`, si existe. */
  srcSpan: { start: number; end: number } | null;
}

export interface SlotScan {
  /** Texto exacto al que se refieren las posiciones (saltos de linea LF). */
  source: string;
  slots: ImageSlot[];
}

export type SlotResult = { kind: 'ready'; imageId: string } | { kind: 'pending' };

export interface SlotEdit {
  slot: ImageSlot;
  result: SlotResult;
}

/** Normaliza los saltos de linea: las posiciones de `parse5` y las del texto deben coincidir. */
export function normalizeEol(html: string): string {
  return html.replace(/\r\n?/g, '\n');
}

export async function findImageSlots(html: string): Promise<SlotScan> {
  const source = normalizeEol(html);
  // Cheap: la mayoria de las paginas no llevan ningun marcador y no pagan el parseo.
  if (!source.includes(IMAGE_ATTR)) return { source, slots: [] };

  const { parse } = await import('parse5');
  const document = parse(source, { sourceCodeLocationInfo: true });

  const found: Omit<ImageSlot, 'index'>[] = [];
  const stack: ParseNode[] = [document];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isElement(node) && node.tagName === 'img') {
      const slot = toSlot(node);
      if (slot) found.push(slot);
    }
    for (const child of childrenOf(node)) stack.push(child);
  }

  // El arbol puede no seguir el orden del texto: se ordena por posicion.
  found.sort((a, b) => a.start - b.start);
  return { source, slots: found.map((slot, index) => ({ ...slot, index })) };
}

function toSlot(node: ParseElement): Omit<ImageSlot, 'index'> | null {
  const prompt = attr(node, IMAGE_ATTR)?.trim();
  const startTag = node.sourceCodeLocation?.startTag;
  if (!prompt || !startTag) return null;

  const src = attr(node, 'src');
  const srcLocation = node.sourceCodeLocation?.attrs?.src;
  return {
    start: startTag.startOffset,
    end: startTag.endOffset,
    prompt,
    alt: attr(node, 'alt') ?? '',
    src: src ?? null,
    state: src !== undefined && READY_SRC.test(src.trim()) ? 'ready' : 'pending',
    srcSpan: srcLocation ? { start: srcLocation.startOffset, end: srcLocation.endOffset } : null,
  };
}

/**
 * Aplica los resultados sobre el texto que devolvio `findImageSlots`:
 *   - `ready`   -> `src="/api/landing-images/<id>"` y se quita el comentario
 *                  de pendiente que hubiera justo antes;
 *   - `pending` -> `src` del bloque neutro y, una sola vez, un comentario con
 *                  el prompt justo antes de la etiqueta.
 * Todo lo que no es una etiqueta marcada queda igual, byte a byte.
 */
export function applySlotResults(source: string, edits: SlotEdit[]): string {
  const operations: Array<{ from: number; to: number; text: string }> = [];

  for (const { slot, result } of edits) {
    if (slot.end > source.length || !source.slice(slot.start, slot.end).startsWith('<')) {
      throw new Error('Las posiciones del marcador no corresponden al texto: el HTML cambio entre el analisis y la edicion.');
    }

    const newSrc = result.kind === 'ready' ? imageUrl(result.imageId) : PLACEHOLDER_SRC;

    if (slot.srcSpan) {
      operations.push({ from: slot.srcSpan.start, to: slot.srcSpan.end, text: `src="${newSrc}"` });
    } else {
      // Justo tras `<img`: nunca cae dentro de un valor ni detras de una `/>`.
      const at = slot.start + '<img'.length;
      operations.push({ from: at, to: at, text: ` src="${newSrc}"` });
    }

    const previous = precedingPendingComment(source, slot.start);
    if (result.kind === 'ready') {
      if (previous) operations.push({ from: previous.start, to: previous.end, text: '' });
    } else if (!previous) {
      operations.push({ from: slot.start, to: slot.start, text: `${pendingComment(slot.prompt)}\n${indentOf(source, slot.start)}` });
    }
  }

  // De atras hacia delante: cada edicion deja intactas las posiciones anteriores.
  operations.sort((a, b) => b.from - a.from || b.to - a.to);
  let out = source;
  for (const { from, to, text } of operations) {
    out = out.slice(0, from) + text + out.slice(to);
  }
  return out;
}

/** Fragmento de expresion regular que reconoce la URL de una imagen generada y captura su id. */
export const IMAGE_URL_PATTERN = `${IMAGE_ROUTE_PREFIX.replace(/\//g, '\\/')}(${UUID})`;

/** Etiqueta `<img ...>` completa, sin confundirse con un `>` dentro de un valor entre comillas. */
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/**
 * Recuento rapido de marcadores para la interfaz (insignia "Imagenes 3/4" y
 * boton de reintento), sin cargar `parse5` en el navegador. Es una aproximacion
 * por expresion regular: sirve para mostrar, no para editar; las ediciones usan
 * `findImageSlots`.
 */
export function countImageSlots(html: string): { total: number; ready: number; pending: number } {
  if (!html.includes(IMAGE_ATTR)) return { total: 0, ready: 0, pending: 0 };

  let total = 0;
  let ready = 0;
  for (const match of html.matchAll(IMG_TAG)) {
    const tag = match[0];
    if (!new RegExp(`\\s${IMAGE_ATTR}\\s*=`, 'i').test(tag)) continue;
    total += 1;
    if (new RegExp(`\\ssrc\\s*=\\s*["']?${IMAGE_URL_PATTERN}`, 'i').test(tag)) ready += 1;
  }
  return { total, ready, pending: total - ready };
}

/**
 * `true` solo para un uuid. Es la UNICA validacion que separa un identificador
 * de imagen de una ruta de fichero: la ruta publica y el almacen local la usan
 * antes de tocar el disco, asi que un `../` nunca llega a `fs`.
 */
export function isImageId(value: string): boolean {
  return UUID_ONLY.test(value);
}

export function imageUrl(imageId: string): string {
  if (!isImageId(imageId)) throw new Error('Identificador de imagen invalido.');
  return `${IMAGE_ROUTE_PREFIX}${imageId.toLowerCase()}`;
}

/** Un comentario HTML no puede contener `--` ni `>` sin cerrar: se sanea el prompt. */
export function pendingComment(prompt: string): string {
  const safe = prompt.replace(/[<>]/g, '').replace(/-{2,}/g, '-').replace(/\s+/g, ' ').trim().slice(0, 600);
  return `<!-- ${PENDING_COMMENT_LABEL}: ${safe} -->`;
}

/**
 * Sangria de la linea donde empieza la etiqueta, para que el comentario que se
 * inserta delante no deje la etiqueta desalineada. Si la etiqueta no abre su
 * linea (`<figure><img ...>`), no hay sangria que conservar.
 */
function indentOf(source: string, start: number): string {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const before = source.slice(lineStart, start);
  return /^[ \t]*$/.test(before) ? before : '';
}

/** Comentario de pendiente inmediatamente antes de `start` (solo espacios entre medias). */
function precedingPendingComment(source: string, start: number): { start: number; end: number } | null {
  const windowStart = Math.max(0, start - 800);
  const before = source.slice(windowStart, start);
  const match = new RegExp(`<!-- ${PENDING_COMMENT_LABEL}: [^>]*-->\\s*$`).exec(before);
  return match ? { start: windowStart + match.index, end: start } : null;
}

function attr(node: ParseElement, name: string): string | undefined {
  return node.attrs.find((item) => item.name === name)?.value;
}

function isElement(node: ParseNode): node is ParseElement {
  return 'tagName' in node;
}

function childrenOf(node: ParseNode): ParseNode[] {
  const out: ParseNode[] = [];
  if ('childNodes' in node) out.push(...node.childNodes);
  // `<template>` guarda sus hijos aparte.
  if ('content' in node && node.content) out.push(...node.content.childNodes);
  return out;
}
