import { escapeHtml } from '@/lib/utils';
import type { ValidatedOutput, ValidationIssue } from '@/types/services';

/**
 * Output Validator
 *
 * No se confia en la respuesta del modelo. Este servicio:
 *  1. normaliza la salida (elimina bloques de markdown y texto conversacional);
 *  2. comprueba que exista un documento HTML utilizable;
 *  3. verifica estructura minima, tamano y compatibilidad con `iframe.srcDoc`;
 *  4. devuelve errores bloqueantes y avisos no bloqueantes por separado.
 */

/** Limite superior razonable para un documento de landing (2 MB). */
const MAX_SIZE_BYTES = 2 * 1024 * 1024;
/** Por debajo de esto no hay pagina suficiente. */
const MIN_SIZE_BYTES = 800;

export interface ValidateLandingOptions {
  /**
   * `false` en ediciones manuales: el texto del usuario no se toca (ni se
   * recortan bloques ni se envuelven fragmentos), solo se informa. Con el
   * valor por defecto se asume salida de un LLM y se normaliza.
   */
  normalize?: boolean;
}

export function validateLandingOutput(raw: string, options: ValidateLandingOptions = {}): ValidatedOutput {
  const issues: ValidationIssue[] = [];
  const { html, normalized } =
    options.normalize === false ? { html: raw, normalized: false } : normalizeToDocument(raw, issues);

  const sizeBytes = Buffer.byteLength(html, 'utf8');
  const lower = html.toLowerCase();

  if (html.trim().length === 0) {
    return emptyResult([
      { code: 'empty_output', message: 'El modelo no devolvio ningun contenido.', severity: 'error' },
    ]);
  }

  if (!lower.includes('<html')) {
    issues.push({
      code: 'missing_html_tag',
      message: 'La respuesta no contiene un elemento <html>.',
      severity: 'error',
    });
  }
  if (!lower.includes('<body')) {
    issues.push({
      code: 'missing_body_tag',
      message: 'La respuesta no contiene un elemento <body>.',
      severity: 'error',
    });
  }
  if (!lower.includes('<!doctype html')) {
    issues.push({
      code: 'missing_doctype',
      message: 'Falta la declaracion <!DOCTYPE html>.',
      severity: 'warning',
    });
  }

  if (sizeBytes > MAX_SIZE_BYTES) {
    issues.push({
      code: 'too_large',
      message: `El documento pesa ${(sizeBytes / 1024 / 1024).toFixed(1)} MB y supera el limite de 2 MB.`,
      severity: 'error',
    });
  }
  if (sizeBytes < MIN_SIZE_BYTES) {
    issues.push({
      code: 'too_small',
      message: 'El documento es demasiado corto para ser una Landing Page completa.',
      severity: 'error',
    });
  }

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    issues.push({
      code: 'missing_viewport',
      message: 'Falta la etiqueta meta viewport: la pagina no sera responsive en moviles.',
      severity: 'warning',
    });
  }
  if (!/<html[^>]+lang=/i.test(html)) {
    issues.push({
      code: 'missing_lang',
      message: 'El elemento <html> no declara el idioma.',
      severity: 'warning',
    });
  }
  if (!/<h1[\s>]/i.test(html)) {
    issues.push({
      code: 'missing_h1',
      message: 'La pagina no tiene un encabezado <h1>.',
      severity: 'warning',
    });
  }
  if (/lorem ipsum/i.test(html)) {
    issues.push({
      code: 'placeholder_text',
      message: 'El documento contiene texto de relleno (lorem ipsum).',
      severity: 'warning',
    });
  }
  if (/\{\{\s*[a-z_]+\s*\}\}|\[(?:TODO|PLACEHOLDER)\]/i.test(html)) {
    issues.push({
      code: 'unresolved_placeholder',
      message: 'Quedan marcadores de posicion sin sustituir.',
      severity: 'warning',
    });
  }

  const title = extractTitle(html);
  if (!title) {
    issues.push({ code: 'missing_title', message: 'El documento no tiene <title>.', severity: 'warning' });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    html,
    title: title ?? 'Landing Page sin titulo',
    description: extractDescription(html),
    sections: extractSections(html),
    sizeBytes,
    hasScript: /<script[\s>]/i.test(html),
    hasStyle: /<style[\s>]/i.test(html) || /<link[^>]+rel=["']stylesheet/i.test(html),
    issues,
    normalized,
  };
}

/**
 * Convierte la respuesta cruda en un documento HTML.
 * Cubre los tres fallos tipicos: bloque markdown, preambulo conversacional
 * y fragmento sin envoltorio de documento.
 */
function normalizeToDocument(raw: string, issues: ValidationIssue[]): { html: string; normalized: boolean } {
  let text = raw.trim();
  let normalized = false;

  // 1. Bloque de codigo markdown
  const fenced = /```(?:html|HTML)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) {
    text = fenced[1].trim();
    normalized = true;
    issues.push({
      code: 'markdown_fence',
      message: 'La respuesta venia envuelta en un bloque de markdown; se extrajo el codigo.',
      severity: 'warning',
    });
  }

  // 2. Texto conversacional antes o despues del documento
  const start = text.search(/<!DOCTYPE\s+html/i);
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (start > 0 || (end !== -1 && end + 7 < text.length)) {
    const from = start === -1 ? 0 : start;
    const to = end === -1 ? text.length : end + 7;
    if (to > from) {
      text = text.slice(from, to).trim();
      normalized = true;
      issues.push({
        code: 'conversational_wrapper',
        message: 'El modelo anadio texto fuera del documento; se descarto y se conservo solo el HTML.',
        severity: 'warning',
      });
    }
  }

  // 3. Fragmento sin documento: se envuelve para poder previsualizarlo
  if (!/<html[\s>]/i.test(text) && /<[a-z][\s\S]*>/i.test(text)) {
    text = wrapFragment(text);
    normalized = true;
    issues.push({
      code: 'fragment_wrapped',
      message: 'La respuesta era un fragmento HTML; se envolvio en un documento completo.',
      severity: 'warning',
    });
  }

  return { html: text, normalized };
}

function wrapFragment(fragment: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Landing Page</title>
</head>
<body>
${fragment}
</body>
</html>`;
}

function extractTitle(html: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (title && title.length > 0) return decodeEntities(title).slice(0, 160);

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) return decodeEntities(h1.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 160);

  return null;
}

function extractDescription(html: string): string {
  const meta = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  if (meta) return decodeEntities(meta).slice(0, 300);

  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1];
  if (paragraph) {
    return decodeEntities(paragraph.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 300);
  }
  return '';
}

/** Lista las secciones detectadas, util para la ficha de la Landing Page. */
function extractSections(html: string): string[] {
  const sections: string[] = [];

  const sectionPattern = /<section[^>]*\bid=["']([^"']+)["'][^>]*>/gi;
  let match = sectionPattern.exec(html);
  while (match !== null) {
    if (match[1]) sections.push(match[1]);
    match = sectionPattern.exec(html);
  }

  if (sections.length === 0) {
    const headingPattern = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
    let heading = headingPattern.exec(html);
    while (heading !== null) {
      const text = decodeEntities((heading[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) sections.push(text.slice(0, 60));
      heading = headingPattern.exec(html);
    }
  }

  return sections.slice(0, 20);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ');
}

function emptyResult(issues: ValidationIssue[]): ValidatedOutput {
  return {
    valid: false,
    html: '',
    title: '',
    description: '',
    sections: [],
    sizeBytes: 0,
    hasScript: false,
    hasStyle: false,
    issues,
    normalized: false,
  };
}

/**
 * Documento que se muestra en la vista previa cuando la generacion falla.
 * Evita dejar el iframe en blanco sin explicacion.
 */
export function buildErrorPreview(message: string, hint?: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>No se pudo generar la vista previa</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf9f7;color:#1a1a1a;
       font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:2rem}
  .card{max-width:32rem;border:1px solid #e0ded9;background:#fff;padding:2rem}
  h1{font-size:1.1rem;margin:0 0 .75rem}
  p{margin:0 0 .5rem;color:#5a5a5a;line-height:1.55}
  code{font-family:ui-monospace,Consolas,monospace;font-size:.85em;background:#f2f0ec;padding:.15em .35em}
</style>
</head>
<body>
  <div class="card">
    <h1>No se pudo generar la vista previa</h1>
    <p>${escapeHtml(message)}</p>
    ${hint ? `<p><code>${escapeHtml(hint)}</code></p>` : ''}
  </div>
</body>
</html>`;
}
