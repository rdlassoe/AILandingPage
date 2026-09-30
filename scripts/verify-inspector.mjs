/**
 * Verificacion de la instrumentacion del inspector (`src/lib/preview/instrument.ts`).
 *
 *   npm run verify:inspector
 *
 * No necesita servidor ni claves. Comprueba, sobre fixtures con los casos que
 * rompen a los mapeos ingenuos Y sobre las landings reales de `.data/db.json`
 * si existe, que:
 *
 *   1. cada posicion guardada apunta exactamente al `<` de su etiqueta;
 *   2. el HTML instrumentado produce el MISMO arbol que el original (las marcas
 *      no alteran ni atributos ni estructura);
 *   3. quitar marcas y script devuelve el original, byte a byte;
 *   4. `findEntryAt` encuentra el elemento mas profundo bajo una posicion.
 *
 * Sale con codigo 1 si alguna comprobacion falla.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { parse, serialize } from 'parse5';

import { inspectorRuntime } from '../src/lib/preview/inspector-runtime.ts';
import { parseFrameMessage } from '../src/lib/preview/messages.ts';
import {
  SRC_ATTR,
  findEntryAt,
  injectRuntime,
  instrumentHtml,
  normalizeEol,
  stripInstrumentation,
} from '../src/lib/preview/instrument.ts';

// Valor de PREVIEW_NS (`src/types/preview.ts`). Se lee del archivo en vez de
// importarlo: ese modulo usa el alias `@/` en otros sitios y no es ejecutable aqui.
const PREVIEW_NS_VALUE = /PREVIEW_NS\s*=\s*'([^']+)'/.exec(
  readFileSync(fileURLToPath(new URL('../src/types/preview.ts', import.meta.url)), 'utf8'),
)?.[1];

let failures = 0;
const log =(ok, label, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/** Quita `data-ale-src` de todo el arbol y serializa: sirve para comparar estructuras. */
function structure(html) {
  const document = parse(html);
  const stack = [document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.attrs) node.attrs = node.attrs.filter((attr) => attr.name !== SRC_ATTR);
    if (node.content) stack.push(node.content);
    if (node.childNodes) stack.push(...node.childNodes);
  }
  return serialize(document);
}

async function check(name, input) {
  const { html, map } = await instrumentHtml(input);
  const problems = [];

  if (map.source.includes('\r')) problems.push('map.source conserva \\r');
  if (map.source !== normalizeEol(input)) problems.push('map.source no es el texto normalizado');

  // 1. Cada posicion apunta al `<tag` de su etiqueta.
  for (const entry of map.entries) {
    const tag = map.source.slice(entry.start, entry.tagEnd);
    const opens = tag.slice(0, 1 + entry.tag.length).toLowerCase() === `<${entry.tag.toLowerCase()}`;
    if (!opens || !tag.endsWith('>') || entry.tagEnd > entry.end) {
      problems.push(`posicion ${entry.start} (<${entry.tag}>) no apunta a su etiqueta: ${JSON.stringify(tag.slice(0, 40))}`);
    }
    const marks = html.split(`${SRC_ATTR}="${entry.start}"`).length - 1;
    if (marks !== 1) problems.push(`<${entry.tag}> en ${entry.start} tiene ${marks} marcas`);
  }
  const totalMarks = html.split(`${SRC_ATTR}=`).length - 1;
  if (totalMarks !== map.entries.length) problems.push(`${totalMarks} marcas para ${map.entries.length} entradas`);

  // 2. Mismo arbol.
  if (structure(html) !== structure(map.source)) problems.push('el arbol instrumentado difiere del original');

  // 3. Ida y vuelta exacta.
  const withRuntime = injectRuntime(html, '/* runtime */ var x = "</script>";');
  if (stripInstrumentation(withRuntime) !== map.source) problems.push('quitar marcas y script no devuelve el original');
  const at = withRuntime.indexOf('<script data-ale-runtime>');
  if (at === -1) problems.push('no se inyecto el runtime');
  if (withRuntime.split('data-ale-runtime').length !== 2) problems.push('el runtime aparece mas de una vez');

  // 4. Busqueda por posicion.
  for (const entry of map.entries) {
    const hit = findEntryAt(map, entry.start);
    if (!hit || hit.start !== entry.start) {
      problems.push(`findEntryAt(${entry.start}) devolvio ${hit ? hit.start : 'null'}`);
    }
  }

  log(problems.length === 0, name, `${map.entries.length} elementos`);
  for (const problem of problems.slice(0, 6)) console.log(`        - ${problem}`);
}

const fixtures = {
  'documento con anidados': `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>t</title></head>
<body><header><nav><a href="#a">A</a><a href="#b">B</a></nav></header>
<main><section id="a"><h1>Titulo</h1><p>Texto <strong>fuerte</strong></p></section></main>
</body></html>`,

  'void y autocerradas': `<!DOCTYPE html><html><body>
<img src=a.png alt="x"><br/><input disabled/><hr>
<a href=foo/>enlace con / en el valor</a>
<input value="a/" />
</body></html>`,

  'atributos con > y comillas': `<!DOCTYPE html><html><body>
<div title="a > b" data-x='1>2' class=plain><span data-y="&gt;">x</span></div>
</body></html>`,

  'script y style con marcado falso': `<!DOCTYPE html><html><head><style>a>b{color:red} /* <div> */</style></head><body>
<p>antes</p>
<script>const s = "</div>"; if (1 < 2 && 3 > 2) { document.title = '<p>'; }</script>
<p>despues</p>
</body></html>`,

  'comentarios con etiquetas': `<!DOCTYPE html><html><body><!-- <div id="no"> --><p>uno</p><!-- </body> --><p>dos</p></body></html>`,

  'tabla con tbody implicito': `<!DOCTYPE html><html><body><table><tr><td>1</td><td>2</td></tr></table></body></html>`,

  'tabla mal formada (foster parenting)': `<!DOCTYPE html><html><body><table><div>fuera</div><tr><td>y</td></tr></table><p>fin</p></body></html>`,

  'emoji y acentos (UTF-16)': `<!DOCTYPE html><html><body><p>😀 ñandú 👨‍👩‍👧</p><h1>título</h1><p>🚀</p></body></html>`,

  'saltos CRLF': '<!DOCTYPE html>\r\n<html>\r\n<body>\r\n<h1>uno</h1>\r\n<p>dos</p>\r\n</body>\r\n</html>',

  'fragmento sin html ni body': `<div class="a">uno</div>\n<p>dos</p>`,

  'etiquetas en mayusculas': `<!DOCTYPE html><HTML><BODY><DIV CLASS="x">a</DIV><P>b</P></BODY></HTML>`,

  'template': `<!DOCTYPE html><html><body><template id="t"><div class="card"><span>dentro</span></div></template><p>fuera</p></body></html>`,

  'svg': `<!DOCTYPE html><html><body><svg viewBox="0 0 10 10"><path d="M0 0L5 5"/><foreignObject><div>x</div></foreignObject></svg></body></html>`,

  'sin </body>': `<!DOCTYPE html><html><body><h1>sin cierre</h1><p>texto`,

  'cadena </body> dentro de un script': `<!DOCTYPE html><html><body><script>var s = "</body>";</script><h1>x</h1></body></html>`,
};

for (const [name, html] of Object.entries(fixtures)) {
  await check(`fixture: ${name}`, html);
}

// El runtime debe quedar antes del ULTIMO </body>, no dentro de la cadena del script.
{
  const { html } = await instrumentHtml(fixtures['cadena </body> dentro de un script']);
  const out = injectRuntime(html, '/* r */');
  const runtimeAt = out.indexOf('<script data-ale-runtime>');
  log(runtimeAt > out.indexOf('<h1'), 'el runtime se inyecta antes del ultimo </body>');
}

// Posicion en medio del texto de un elemento -> ese elemento.
{
  const { map } = await instrumentHtml('<!DOCTYPE html><html><body><main><p>hola mundo</p></main></body></html>');
  const inText = map.source.indexOf('mundo');
  log(findEntryAt(map, inText)?.tag === 'p', 'findEntryAt dentro del texto devuelve el <p>');
  const inMain = map.source.indexOf('</main>');
  log(findEntryAt(map, inMain)?.tag === 'main', 'findEntryAt tras el ultimo hijo devuelve el <main>');
}

/* ------------------------------------------------------------------------
 * Validacion de mensajes del iframe (`parseFrameMessage`)
 *
 * El HTML generado corre en el mismo iframe y puede enviar mensajes iguales a
 * los del inspector: solo se acepta lo que cumple el contrato.
 * --------------------------------------------------------------------- */
{
  const LEN = 1000;
  const good = {
    ns: 'ale',
    rev: 3,
    type: 'pick',
    hit: {
      src: 10,
      dynamic: false,
      tag: 'h1',
      id: 'x',
      classes: ['a', 'b'],
      text: 'hola',
      width: 100.4,
      height: 20,
      chain: [{ src: 10, tag: 'h1', id: 'x', classes: [] }, { src: 4, tag: 'body', id: '', classes: [] }],
    },
  };
  const parse = (data, rev = 3) => parseFrameMessage(data, rev, LEN);
  const withHit = (patch) => ({ ...good, hit: { ...good.hit, ...patch } });

  log(parse(good)?.type === 'pick', 'mensaje valido se acepta');
  log(parse(good)?.hit.width === 100, 'las medidas se redondean');
  log(parse(good, 4) === null, 'rev de otro render se descarta');
  log(parse({ ...good, ns: 'otro' }) === null, 'otro espacio de nombres se descarta');
  log(parse('pick') === null && parse(null) === null && parse([good]) === null, 'valores que no son objeto se descartan');
  log(parse(withHit({ src: LEN })) === null, 'posicion fuera del texto se descarta');
  log(parse(withHit({ src: -1 })) === null, 'posicion negativa se descarta');
  log(parse(withHit({ src: 1.5 })) === null, 'posicion no entera se descarta');
  log(parse(withHit({ src: '10' })) === null, 'posicion como texto se descarta');
  log(parse(withHit({ src: null }))?.hit.src === null, 'src null (sin ancestro marcado) se acepta');
  log(parse(withHit({ tag: '"><img src=x onerror=alert(1)>' })) === null, 'tag con marcado se descarta');
  log(parse(withHit({ text: 'x'.repeat(5000) }))?.hit.text.length === 200, 'el texto se recorta a 200');
  log(parse(withHit({ classes: Array(50).fill('c') }))?.hit.classes.length === 8, 'las clases se recortan a 8');
  log(parse(withHit({ width: Infinity })) === null, 'medida infinita se descarta');
  log(
    parse(withHit({ chain: [{ src: 99999, tag: 'p', id: '', classes: [] }, good.hit.chain[0]] }))?.hit.chain.length === 1,
    'los elementos de la cadena fuera de rango se filtran',
  );
  log(parse({ ns: 'ale', rev: 3, type: 'scroll', y: -50 })?.y === 0, 'scroll negativo se acota a 0');
  log(parse({ ns: 'ale', rev: 3, type: 'scroll', y: NaN }) === null, 'scroll NaN se descarta');
  log(parse({ ns: 'ale', rev: 3, type: 'ready' })?.type === 'ready', 'ready se acepta');
  log(parse({ ns: 'ale', rev: 3, type: 'eval', code: 'alert(1)' }) === null, 'tipo desconocido se descarta');
}

/* ------------------------------------------------------------------------
 * Runtime del inspector
 *
 * Se incrusta con `toString()`, asi que no puede depender de nada del modulo.
 * Se ejecuta en un contexto `vm` sin acceso a este: un ReferenceError delataria
 * una dependencia oculta.
 * --------------------------------------------------------------------- */
{
  const source = inspectorRuntime.toString();
  log(!/<\/script/i.test(source), 'el runtime no contiene </script');
  log(source.includes(`'${SRC_ATTR}'`), `el runtime usa el mismo atributo (${SRC_ATTR})`);
  log(source.includes(`'${PREVIEW_NS_VALUE}'`), `el runtime usa el mismo espacio de nombres (${PREVIEW_NS_VALUE})`);

  const sent = [];
  const listeners = {};
  const fakeElement = () => ({
    style: {},
    setAttribute() {},
    append() {},
    addEventListener() {},
    removeEventListener() {},
  });
  const window_ = {
    parent: { postMessage: (message) => sent.push(message) },
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    removeEventListener() {},
    scrollTo() {},
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn) => fn(),
    innerWidth: 1280,
    innerHeight: 800,
    scrollY: 0,
  };
  const context = {
    window: window_,
    document: {
      readyState: 'complete',
      createElement: fakeElement,
      documentElement: fakeElement(),
      addEventListener() {},
      removeEventListener() {},
    },
    Element: class {},
  };
  vm.createContext(context);

  let error = null;
  try {
    vm.runInContext(`(${source})(${JSON.stringify({ rev: 7, scrollY: 0, inspecting: true })})`, context);
  } catch (caught) {
    error = caught;
  }
  log(error === null, 'el runtime se ejecuta sin dependencias del modulo', error ? String(error) : '');
  const ready = sent.find((message) => message.type === 'ready');
  log(ready?.ns === 'ale' && ready?.rev === 7, 'el runtime avisa ready con su ns y su rev');

  // Y acepta ordenes del padre solo si vienen del padre.
  const before = sent.length;
  listeners.message?.({ source: {}, data: { ns: 'ale', type: 'inspect', on: false } });
  listeners.message?.({ source: window_.parent, data: { ns: 'ale', type: 'inspect', on: false } });
  log(sent.length === before, 'el runtime procesa mensajes del padre sin errores');
}

// Landings reales ya generadas en este equipo (almacen local), si las hay.
const dbPath = fileURLToPath(new URL('../.data/db.json', import.meta.url));
if (existsSync(dbPath)) {
  const db = JSON.parse(readFileSync(dbPath, 'utf8'));
  const landings = db.landingPages ?? [];
  console.log(`\nLandings reales de .data/db.json: ${landings.length}`);
  for (const landing of landings) {
    await check(`landing: ${String(landing.name).slice(0, 48)}`, landing.html ?? '');
  }
} else {
  console.log('\n(no hay .data/db.json: se omiten las landings reales)');
}

console.log(failures === 0 ? '\nTODO CORRECTO' : `\n${failures} comprobacion(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
