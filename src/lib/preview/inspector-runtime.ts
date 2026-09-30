import type { PreviewRuntimeConfig } from '@/types/preview';

/**
 * Script del inspector. NO se ejecuta en la aplicacion: se serializa con
 * `toString()` y se incrusta en el documento de la vista previa
 * (`buildPreviewDocument`), donde corre dentro del iframe aislado.
 *
 * Por eso debe ser AUTOCONTENIDA: no puede usar nada de fuera de su cuerpo
 * (ni importaciones, ni constantes del modulo). Los valores compartidos con el
 * resto del codigo estan repetidos aqui, con su origen:
 *   - 'ale'          <- PREVIEW_NS        (src/types/preview.ts)
 *   - 'data-ale-src' <- SRC_ATTR          (src/lib/preview/instrument.ts)
 * `scripts/verify-inspector.mjs` comprueba que siguen coincidiendo.
 *
 * Mientras el modo inspeccion esta apagado no registra ningun listener de
 * interaccion: la pagina se comporta exactamente como sin el inspector.
 */
export function inspectorRuntime(config: PreviewRuntimeConfig): void {
  const NS = 'ale';
  const ATTR = 'data-ale-src';
  const ACCENT = '#2740e8';

  const send = (message: Record<string, unknown>) => {
    try {
      // El origen del iframe es opaco: no hay un `targetOrigin` concreto posible.
      window.parent.postMessage({ ns: NS, rev: config.rev, ...message }, '*');
    } catch {
      // Sin padre (documento abierto suelto): no hay nadie a quien avisar.
    }
  };

  /* ------------------------------------------------------------ scroll */

  if (config.scrollY > 0) {
    const restore = () => window.scrollTo({ top: config.scrollY, left: 0, behavior: 'instant' });
    restore();
    window.addEventListener('load', restore, { once: true });
  }

  let scrollTimer = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollTimer) return;
      scrollTimer = window.setTimeout(() => {
        scrollTimer = 0;
        send({ type: 'scroll', y: window.scrollY });
      }, 120);
    },
    { passive: true },
  );

  /* ---------------------------------------------------------- overlays */

  const makeBox = (dashed: boolean) => {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText =
      'position:fixed;z-index:2147483646;pointer-events:none;display:none;box-sizing:border-box;' +
      `border:2px ${dashed ? 'dashed' : 'solid'} ${ACCENT};` +
      (dashed ? '' : `background:${ACCENT}1f;`);
    return box;
  };
  const hoverBox = makeBox(false);
  const pickedBox = makeBox(true);
  const label = document.createElement('div');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText =
    'position:fixed;z-index:2147483647;pointer-events:none;display:none;max-width:90vw;' +
    `background:${ACCENT};color:#fff;font:11px/1.4 ui-monospace,Consolas,monospace;` +
    'padding:2px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  document.documentElement.append(hoverBox, pickedBox, label);

  let hovered: Element | null = null;
  let picked: Element | null = null;

  const place = (box: HTMLElement, element: Element | null) => {
    if (!element || !element.isConnected) {
      box.style.display = 'none';
      return null;
    }
    const rect = element.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    return rect;
  };

  const describe = (element: Element) => {
    const id = element.id ? `#${element.id}` : '';
    const classes = Array.from(element.classList)
      .slice(0, 3)
      .map((name) => `.${name}`)
      .join('');
    return `${element.tagName.toLowerCase()}${id}${classes}`;
  };

  const refresh = () => {
    const rect = place(hoverBox, hovered);
    if (rect && hovered) {
      label.textContent = `${describe(hovered)}  ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      label.style.display = 'block';
      // La etiqueta va encima del elemento; si no cabe arriba, dentro.
      const top = rect.top >= 20 ? rect.top - 20 : rect.top + 2;
      label.style.top = `${top}px`;
      label.style.left = `${Math.min(Math.max(rect.left, 0), Math.max(window.innerWidth - 160, 0))}px`;
    } else {
      label.style.display = 'none';
    }
    place(pickedBox, picked);
  };

  let frame = 0;
  const scheduleRefresh = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  };
  window.addEventListener('scroll', scheduleRefresh, { passive: true, capture: true });
  window.addEventListener('resize', scheduleRefresh, { passive: true });

  /* --------------------------------------------------------- inspeccion */

  const elementAt = (event: Event): Element | null => (event.target instanceof Element ? event.target : null);

  const info = (element: Element) => ({
    src: Number(element.getAttribute(ATTR)),
    tag: element.tagName.toLowerCase(),
    id: element.id || '',
    classes: Array.from(element.classList).slice(0, 8),
  });

  const hit = (element: Element) => {
    const marked = element.closest(`[${ATTR}]`);
    const chain: Array<ReturnType<typeof info>> = [];
    for (let node: Element | null = marked; node && chain.length < 40; node = node.parentElement) {
      if (node.hasAttribute(ATTR)) chain.push(info(node));
    }
    const rect = element.getBoundingClientRect();
    return {
      src: marked ? Number(marked.getAttribute(ATTR)) : null,
      dynamic: !element.hasAttribute(ATTR),
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      classes: Array.from(element.classList).slice(0, 8),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      width: rect.width,
      height: rect.height,
      chain,
    };
  };

  const onMove = (event: Event) => {
    hovered = elementAt(event);
    scheduleRefresh();
  };

  const block = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onClick = (event: Event) => {
    block(event);
    const element = elementAt(event);
    if (!element) return;
    picked = element.closest(`[${ATTR}]`) || element;
    scheduleRefresh();
    send({ type: 'pick', hit: hit(element) });
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') send({ type: 'exit' });
  };

  // Eventos con los que una pagina reacciona a un toque o a un clic: mientras se
  // inspecciona no deben llegar a sus controladores (menus, enlaces, formularios).
  const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'submit'];

  let inspecting = false;
  const setInspecting = (on: boolean) => {
    if (on === inspecting) return;
    inspecting = on;
    const options = { capture: true } as const;
    if (on) {
      document.addEventListener('mousemove', onMove, options);
      document.addEventListener('click', onClick, options);
      document.addEventListener('keydown', onKey, options);
      for (const name of BLOCKED) document.addEventListener(name, block, options);
      document.documentElement.style.cursor = 'crosshair';
    } else {
      document.removeEventListener('mousemove', onMove, options);
      document.removeEventListener('click', onClick, options);
      document.removeEventListener('keydown', onKey, options);
      for (const name of BLOCKED) document.removeEventListener(name, block, options);
      document.documentElement.style.cursor = '';
      hovered = null;
      refresh();
    }
  };

  /* ------------------------------------------------ mensajes del padre */

  const highlight = (src: number | null) => {
    picked = src === null ? null : document.querySelector(`[${ATTR}="${src}"]`);
    if (picked) {
      const rect = picked.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        picked.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
    refresh();
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.ns !== NS) return;
    if (data.type === 'inspect') setInspecting(data.on === true);
    else if (data.type === 'highlight') highlight(typeof data.src === 'number' ? data.src : null);
  });

  setInspecting(config.inspecting);
  send({ type: 'ready' });
}
