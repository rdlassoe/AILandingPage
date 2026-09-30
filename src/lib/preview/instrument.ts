import type { DefaultTreeAdapterMap } from 'parse5';

/**
 * Instrumentacion de la vista previa: elemento -> posicion en el codigo.
 *
 * El inspector necesita saber, al hacer clic en la pagina, a que linea del HTML
 * corresponde ese elemento. El iframe esta aislado (sin `allow-same-origin`),
 * asi que el padre no puede leer su DOM: se marca cada etiqueta de apertura con
 * `data-ale-src="<offset>"` en una COPIA del documento y un script dentro del
 * iframe devuelve ese numero por `postMessage`.
 *
 * Las marcas se insertan por manipulacion de cadena sobre las posiciones que
 * da `parse5`, nunca re-serializando el arbol: serializar cambiaria el formato
 * y con el las posiciones. El HTML que se guarda o se exporta no lleva nunca
 * estas marcas, y `stripInstrumentation` devuelve la copia al original exacto.
 *
 * Este archivo no importa nada del proyecto (ni el alias `@/`) para que
 * `scripts/verify-inspector.mjs` pueda ejecutarlo directamente con Node.
 */

type ParseNode = DefaultTreeAdapterMap['node'];
type ParseElement = DefaultTreeAdapterMap['element'];

export const SRC_ATTR = 'data-ale-src';
export const RUNTIME_ATTR = 'data-ale-runtime';

/** Etiquetas que no se dibujan o cuyo contenido no es marcado: no se instrumentan. */
const SKIPPED_TAGS = new Set(['head', 'script', 'style', 'title', 'meta', 'link', 'base', 'noscript']);

export interface SourceEntry {
  /** Posicion (UTF-16) del `<` de la etiqueta de apertura. Es el valor de `data-ale-src`. */
  start: number;
  /** Posicion justo despues del `>` de la etiqueta de apertura. */
  tagEnd: number;
  /** Posicion justo despues del final del elemento (su etiqueta de cierre, si la tiene). */
  end: number;
  tag: string;
}

export interface SourceMap {
  /** Texto exacto al que se refieren las posiciones: el HTML con saltos de linea LF. */
  source: string;
  /** Ordenadas por `start`, es decir, por orden de documento. */
  entries: SourceEntry[];
  byStart: Map<number, SourceEntry>;
}

/**
 * CodeMirror expone el documento con `\n` aunque el texto llegue con `\r\n`.
 * Si las posiciones se calcularan sobre el texto con CRLF, el salto caeria
 * desplazado una posicion por cada linea anterior.
 */
export function normalizeEol(html: string): string {
  return html.replace(/\r\n?/g, '\n');
}

export async function instrumentHtml(input: string): Promise<{ html: string; map: SourceMap }> {
  const source = normalizeEol(input);

  // Solo se descarga al abrir el editor o el inspector.
  const { parse } = await import('parse5');
  const document = parse(source, { sourceCodeLocationInfo: true });

  const entries: SourceEntry[] = [];
  const insertions: Array<{ at: number; start: number }> = [];

  const stack: ParseNode[] = [document];
  while (stack.length > 0) {
    const node = stack.pop()!;

    if (isElement(node)) {
      if (node.tagName === 'head') continue;

      const location = node.sourceCodeLocation;
      const startTag = location?.startTag;
      if (location && startTag && !SKIPPED_TAGS.has(node.tagName)) {
        const at = insertionPoint(node.tagName, startTag.startOffset, location.attrs);
        // Defensivo: el atributo siempre debe caer dentro de la etiqueta de apertura.
        if (at < startTag.endOffset) {
          insertions.push({ at, start: startTag.startOffset });
          entries.push({
            start: startTag.startOffset,
            tagEnd: startTag.endOffset,
            end: location.endOffset,
            tag: node.tagName,
          });
        }
      }
    }

    // Se apila en orden inverso para visitar los hijos en orden de documento.
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }

  // El orden del arbol puede diferir del del texto (elementos recolocados por el
  // parser, como los de una tabla mal formada): se ordena explicitamente.
  entries.sort((a, b) => a.start - b.start);
  insertions.sort((a, b) => a.at - b.at);

  let html = '';
  let cursor = 0;
  for (const { at, start } of insertions) {
    html += `${source.slice(cursor, at)} ${SRC_ATTR}="${start}"`;
    cursor = at;
  }
  html += source.slice(cursor);

  const byStart = new Map(entries.map((entry) => [entry.start, entry]));
  return { html, map: { source, entries, byStart } };
}

/**
 * Donde insertar el atributo: justo despues del ultimo atributo existente o,
 * si no hay ninguno, del nombre de la etiqueta. Asi nunca cae dentro de un
 * valor (`<a href=x/>` es un valor `x/`, no una etiqueta autocerrada) ni
 * despues de la `/` de `<br/>`.
 */
function insertionPoint(tagName: string, start: number, attrs: Record<string, { endOffset: number }> | undefined): number {
  let at = start + 1 + tagName.length;
  if (attrs) {
    for (const attr of Object.values(attrs)) {
      if (attr.endOffset > at) at = attr.endOffset;
    }
  }
  return at;
}

function isElement(node: ParseNode): node is ParseElement {
  return 'tagName' in node;
}

function childrenOf(node: ParseNode): ParseNode[] {
  // El contenido de <template> no cuelga de `childNodes`, sino de `content`.
  if (isElement(node) && node.tagName === 'template' && 'content' in node) {
    return (node.content as { childNodes: ParseNode[] }).childNodes;
  }
  return 'childNodes' in node ? (node.childNodes as ParseNode[]) : [];
}

/** Anade el script del inspector justo antes de `</body>` (o al final si no hay). */
export function injectRuntime(html: string, runtimeSource: string): string {
  // Un `</script` dentro del codigo cerraria la etiqueta antes de tiempo.
  const safe = runtimeSource.replace(/<\/script/gi, '<\\/script');
  const tag = `<script ${RUNTIME_ATTR}>${safe}</script>`;

  // No se usa `toLowerCase().lastIndexOf`: algunos caracteres cambian de longitud
  // al pasar a minusculas y la posicion encontrada no seria la del original.
  let at = -1;
  const closing = /<\/body/gi;
  let match = closing.exec(html);
  while (match !== null) {
    at = match.index;
    match = closing.exec(html);
  }

  return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

/** Inverso exacto de `instrumentHtml` + `injectRuntime`. */
export function stripInstrumentation(html: string): string {
  return html
    .replace(new RegExp(`<script ${RUNTIME_ATTR}>[\\s\\S]*?</script>`), '')
    .replace(new RegExp(` ${SRC_ATTR}="\\d+"`, 'g'), '');
}

/** Linea y columna (desde 1) de una posicion del texto. `source` debe usar solo `\n`. */
export function lineColAt(source: string, position: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let at = source.indexOf('\n'); at !== -1 && at < position; at = source.indexOf('\n', at + 1)) {
    line += 1;
    lineStart = at + 1;
  }
  return { line, col: position - lineStart + 1 };
}

/** Elemento mas profundo cuya etiqueta o contenido contiene la posicion, o `null`. */
export function findEntryAt(map: SourceMap, position: number): SourceEntry | null {
  const { entries } = map;

  // Ultima entrada que empieza en o antes de `position`.
  let low = 0;
  let high = entries.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (entries[middle]!.start <= position) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  // Los elementos que contienen la posicion forman una cadena de ancestros: el
  // primero (hacia atras) que aun no ha terminado es el mas profundo.
  for (let index = found; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.end > position) return entry;
  }
  return null;
}
