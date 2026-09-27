import { clamp } from '@/lib/utils';
import type { CriticDimension, CriticSeverity } from '@/types/domain';

/**
 * Critico en modo demo.
 *
 * No inventa problemas: ejecuta comprobaciones estaticas reales sobre el HTML
 * (accesibilidad, semantica, patrones genericos y diseno sustractivo) y
 * construye el informe a partir de lo que encuentra. Cuando hay un proveedor
 * LLM configurado, el Critic Engine usa el modelo real en lugar de esto.
 */

interface RawIssue {
  dimension: CriticDimension;
  severity: CriticSeverity;
  title: string;
  description: string;
  location: string | null;
  action: string;
  impact: 'alto' | 'medio' | 'bajo';
}

const AI_CLICHES = [
  'revoluciona',
  'desbloquea el poder',
  'lleva tu',
  'siguiente nivel',
  'sin esfuerzo',
  'la solucion definitiva',
  'transforma tu',
  'potencia tu',
  'game changer',
  'cambia las reglas del juego',
];

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

/** Longitud del texto visible, sin etiquetas. */
function textLengthOf(html: string): number {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function buildMockCritique(html: string, requirements: string, constraints: string): string {
  const issues: RawIssue[] = [];
  const lower = html.toLowerCase();

  /* ----------------------------------------------------- accesibilidad */

  if (!/<html[^>]+lang=/i.test(html)) {
    issues.push({
      dimension: 'accessibility',
      severity: 'high',
      title: 'Falta el idioma del documento',
      description:
        'El elemento <html> no declara `lang`. Los lectores de pantalla no saben en que idioma leer el contenido.',
      location: '<html>',
      action: 'Anade lang="es" al elemento <html>.',
      impact: 'alto',
    });
  }

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    issues.push({
      dimension: 'responsive',
      severity: 'critical',
      title: 'Sin meta viewport',
      description: 'Sin la etiqueta viewport la pagina se renderiza a escala de escritorio en moviles.',
      location: '<head>',
      action: 'Anade <meta name="viewport" content="width=device-width, initial-scale=1">.',
      impact: 'alto',
    });
  }

  const imagesWithoutAlt = countMatches(html, /<img(?![^>]*\balt=)[^>]*>/gi);
  if (imagesWithoutAlt > 0) {
    issues.push({
      dimension: 'accessibility',
      severity: 'high',
      title: `${imagesWithoutAlt} ${imagesWithoutAlt === 1 ? 'imagen sin' : 'imagenes sin'} atributo alt`,
      description: 'Las imagenes sin alt no son interpretables por lectores de pantalla.',
      location: '<img>',
      action: 'Describe cada imagen informativa con alt; usa alt="" solo si es puramente decorativa.',
      impact: 'alto',
    });
  }

  const h1Count = countMatches(html, /<h1[\s>]/gi);
  if (h1Count === 0) {
    issues.push({
      dimension: 'hierarchy',
      severity: 'critical',
      title: 'La pagina no tiene h1',
      description: 'Sin h1 no hay un titulo principal identificable ni para usuarios ni para buscadores.',
      location: 'documento',
      action: 'Convierte el titular del hero en un <h1> unico.',
      impact: 'alto',
    });
  } else if (h1Count > 1) {
    issues.push({
      dimension: 'hierarchy',
      severity: 'medium',
      title: `Hay ${h1Count} elementos h1`,
      description: 'Varios h1 diluyen la jerarquia: no queda claro cual es el mensaje principal.',
      location: '<h1>',
      action: 'Deja un unico h1 y baja el resto a h2.',
      impact: 'medio',
    });
  }

  if (!/:focus-visible|:focus\b/.test(html)) {
    issues.push({
      dimension: 'accessibility',
      severity: 'high',
      title: 'Sin estilos de foco visibles',
      description: 'No hay reglas :focus ni :focus-visible: la navegacion por teclado queda sin indicador.',
      location: '<style>',
      action: 'Define :focus-visible con un outline de al menos 2px y offset.',
      impact: 'alto',
    });
  }

  const inputCount = countMatches(html, /<input[^>]*>/gi);
  const labelCount = countMatches(html, /<label[\s>]/gi);
  if (inputCount > 0 && labelCount < inputCount) {
    issues.push({
      dimension: 'accessibility',
      severity: 'high',
      title: 'Campos de formulario sin etiqueta asociada',
      description: `Hay ${inputCount} campos y solo ${labelCount} etiquetas. Un placeholder no sustituye a un <label>.`,
      location: '<form>',
      action: 'Asocia cada input con un <label for="..."> visible.',
      impact: 'alto',
    });
  }

  if (!/prefers-reduced-motion/i.test(html) && /transition|animation/i.test(html)) {
    issues.push({
      dimension: 'accessibility',
      severity: 'low',
      title: 'No se respeta prefers-reduced-motion',
      description: 'La pagina anima elementos sin ofrecer alternativa a quien reduce el movimiento del sistema.',
      location: '<style>',
      action: 'Anade @media (prefers-reduced-motion: reduce) desactivando transiciones no esenciales.',
      impact: 'bajo',
    });
  }

  if (!/skip|saltar al contenido/i.test(html)) {
    issues.push({
      dimension: 'accessibility',
      severity: 'low',
      title: 'Sin enlace para saltar al contenido',
      description: 'Quien navega con teclado tiene que recorrer toda la navegacion en cada carga.',
      location: 'inicio de <body>',
      action: 'Anade un enlace "Saltar al contenido" como primer elemento enfocable.',
      impact: 'bajo',
    });
  }

  /* -------------------------------------------------------- semantica */

  const semanticTags = ['<main', '<header', '<footer', '<section', '<nav'].filter((tag) => lower.includes(tag));
  if (semanticTags.length < 4) {
    issues.push({
      dimension: 'code',
      severity: 'medium',
      title: 'Estructura poco semantica',
      description: `Solo se usan ${semanticTags.length} de los 5 elementos estructurales basicos (main, header, footer, section, nav).`,
      location: 'documento',
      action: 'Sustituye los <div> contenedores por los elementos semanticos correspondientes.',
      impact: 'medio',
    });
  }

  if (!/<title>[^<]{5,}<\/title>/i.test(html)) {
    issues.push({
      dimension: 'content',
      severity: 'medium',
      title: 'Titulo del documento ausente o demasiado corto',
      description: 'El <title> es lo primero que se ve en buscadores y en la pestana del navegador.',
      location: '<head>',
      action: 'Escribe un <title> descriptivo de entre 40 y 60 caracteres.',
      impact: 'medio',
    });
  }

  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{30,}/i.test(html)) {
    issues.push({
      dimension: 'content',
      severity: 'low',
      title: 'Meta description ausente o pobre',
      description: 'Sin meta description el buscador elige un fragmento arbitrario de la pagina.',
      location: '<head>',
      action: 'Anade una meta description concreta de 120-155 caracteres.',
      impact: 'bajo',
    });
  }

  /* ---------------------------------------------- patrones genericos */

  const gradients = countMatches(html, /linear-gradient|radial-gradient/gi);
  if (gradients > 2) {
    issues.push({
      dimension: 'generic-patterns',
      severity: 'medium',
      title: `Uso excesivo de degradados (${gradients})`,
      description: 'Los degradados repetidos son uno de los rasgos mas reconocibles de una landing generada por IA.',
      location: '<style>',
      action: 'Deja como maximo un degradado con proposito y sustituye el resto por color plano.',
      impact: 'medio',
    });
  }

  if (/backdrop-filter\s*:\s*blur/i.test(html)) {
    issues.push({
      dimension: 'generic-patterns',
      severity: 'low',
      title: 'Glassmorphism presente',
      description: 'El desenfoque de fondo reduce el contraste y es un patron visual muy manido.',
      location: '<style>',
      action: 'Sustituye el efecto por superficies solidas con un borde de 1px.',
      impact: 'bajo',
    });
  }

  const cliches = AI_CLICHES.filter((cliche) => lower.includes(cliche));
  if (cliches.length > 0) {
    issues.push({
      dimension: 'content',
      severity: 'medium',
      title: 'Copy con cliches de IA',
      description: `Aparecen expresiones genericas: ${cliches.join(', ')}.`,
      location: 'copy',
      action: 'Reescribe esas frases con datos concretos: que hace, para quien y con que resultado medible.',
      impact: 'alto',
    });
  }

  if (/lorem ipsum/i.test(html)) {
    issues.push({
      dimension: 'content',
      severity: 'critical',
      title: 'Texto de relleno sin sustituir',
      description: 'La pagina contiene lorem ipsum: no es entregable.',
      location: 'copy',
      action: 'Sustituye todo el relleno por contenido real del proyecto.',
      impact: 'alto',
    });
  }

  /* ----------------------------------- metadatos y micro-copy */

  if (!/<meta[^>]+property=["']og:title["']/i.test(html)) {
    issues.push({
      dimension: 'content',
      severity: 'medium',
      title: 'Sin metadatos Open Graph',
      description:
        'Cuando alguien comparta el enlace en Slack, LinkedIn o WhatsApp, la vista previa saldra vacia o con un fragmento arbitrario.',
      location: '<head>',
      action:
        'Anade metadatos Open Graph (og:title, og:description, og:type, og:site_name) y las etiquetas twitter:card equivalentes.',
      impact: 'medio',
    });
  }

  if (!/application\/ld\+json/i.test(html)) {
    issues.push({
      dimension: 'content',
      severity: 'low',
      title: 'Sin datos estructurados',
      description:
        'No hay JSON-LD, asi que los buscadores tienen que inferir de que trata la pagina y no pueden mostrar resultados enriquecidos.',
      location: '<head>',
      action: 'Anade un bloque JSON-LD (schema.org) describiendo la pagina y las preguntas frecuentes.',
      impact: 'bajo',
    });
  }

  if (!/<link[^>]+rel=["']icon["']/i.test(html) && !/name=["']theme-color["']/i.test(html)) {
    issues.push({
      dimension: 'visual-consistency',
      severity: 'low',
      title: 'Sin favicon ni theme-color',
      description: 'La pestana del navegador muestra el icono por defecto y el navegador movil no adopta el color de marca.',
      location: '<head>',
      action: 'Anade un favicon SVG inline y una etiqueta theme-color con el color de acento.',
      impact: 'bajo',
    });
  }

  const hasForm = /<form[\s>]/i.test(html);
  const hasPrivacyNote = /(no compartimos|no se comparte|darte de baja|solo usamos|privacidad|no enviamos spam)/i.test(html);
  if (hasForm && !hasPrivacyNote) {
    issues.push({
      dimension: 'cta',
      severity: 'medium',
      title: 'El formulario no dice que pasa con los datos',
      description:
        'Pedir un correo sin explicar para que se usa es una de las fricciones que mas abandono provoca justo antes de convertir.',
      location: '<form>',
      action:
        'Anade micro-copy bajo el boton explicando para que se usa el correo, con que frecuencia se escribe y como darse de baja.',
      impact: 'alto',
    });
  }

  const hasImagery = /<img[\s>]/i.test(html) || /<svg[^>]*role=["']img["']/i.test(html);
  if (!hasImagery && textLengthOf(html) > 1500) {
    issues.push({
      dimension: 'hierarchy',
      severity: 'low',
      title: 'Pagina sin ningun apoyo visual',
      description:
        'Todo el contenido es texto. En paginas largas esto obliga a leerlo todo para entender el producto.',
      location: 'documento',
      action:
        'Anade un diagrama o ilustracion con texto alternativo real que resuma el funcionamiento; nada de fotografia de stock.',
      impact: 'medio',
    });
  }

  /* ------------------------------------------- diseno sustractivo/CTA */

  const sections = countMatches(html, /<section[\s>]/gi);
  if (sections > 9) {
    issues.push({
      dimension: 'subtractive',
      severity: 'medium',
      title: `La pagina tiene ${sections} secciones`,
      description: 'Por encima de ocho secciones la lectura se fragmenta y baja la tasa de llegada al CTA.',
      location: 'documento',
      action: 'Fusiona o elimina las secciones que no aporten comprension, confianza o conversion.',
      impact: 'medio',
    });
  }

  const ctaCount = countMatches(html, /class=["'][^"']*btn[^"']*["']/gi);
  if (ctaCount === 0) {
    issues.push({
      dimension: 'cta',
      severity: 'critical',
      title: 'No se identifica ninguna llamada a la accion',
      description: 'Sin un CTA claro la pagina no puede cumplir su objetivo de negocio.',
      location: 'documento',
      action: 'Anade un CTA primario en el hero y repitelo al cierre.',
      impact: 'alto',
    });
  } else if (ctaCount > 10) {
    issues.push({
      dimension: 'cta',
      severity: 'medium',
      title: `Hay ${ctaCount} elementos con aspecto de boton`,
      description: 'Demasiadas acciones compitiendo diluyen la accion principal.',
      location: 'documento',
      action: 'Deja un unico CTA primario por pantalla y convierte el resto en enlaces secundarios.',
      impact: 'medio',
    });
  }

  const radiusRules = countMatches(html, /border-radius\s*:\s*(1[6-9]|[2-9]\d)px/gi);
  if (radiusRules > 4) {
    issues.push({
      dimension: 'visual-consistency',
      severity: 'low',
      title: 'Radios muy grandes repetidos',
      description: 'El exceso de tarjetas con esquinas muy redondeadas aplana la jerarquia visual.',
      location: '<style>',
      action: 'Unifica el radio en un unico token y reservalo para un tipo de superficie.',
      impact: 'bajo',
    });
  }

  if (!/@media\s*\(\s*(min|max)-width/i.test(html)) {
    issues.push({
      dimension: 'responsive',
      severity: 'high',
      title: 'Sin media queries',
      description: 'No hay ningun punto de ruptura: la maquetacion no se adapta a movil ni a tablet.',
      location: '<style>',
      action: 'Trabaja mobile-first y anade al menos un breakpoint en 768px y otro en 1024px.',
      impact: 'alto',
    });
  }

  const textLength = textLengthOf(html);
  if (textLength < 600) {
    issues.push({
      dimension: 'clarity',
      severity: 'high',
      title: 'Contenido insuficiente',
      description: `La pagina tiene ${textLength} caracteres de texto: no alcanza para explicar la propuesta ni resolver objeciones.`,
      location: 'documento',
      action: 'Desarrolla propuesta de valor, prueba y objeciones con contenido concreto.',
      impact: 'alto',
    });
  }

  if (requirements.length > 0 && constraints.length > 0) {
    const brokenConstraints = constraints
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter((line) => line.length > 0)
      .filter((line) => /degradad|gradient/i.test(line) && gradients > 0);

    for (const broken of brokenConstraints) {
      issues.push({
        dimension: 'generic-patterns',
        severity: 'high',
        title: 'Restriccion negativa incumplida',
        description: `El encargo pedia: "${broken}", pero el codigo sigue usando degradados.`,
        location: '<style>',
        action: 'Elimina los degradados y sustituyelos por color plano o por un cambio de superficie.',
        impact: 'alto',
      });
    }
  }

  /* ------------------------------------------------ informe final */

  const withIds = issues.slice(0, 12).map((issue, index) => ({
    ...issue,
    id: `issue-${index + 1}`,
  }));

  const penalty = (dimension: CriticDimension[]): number =>
    withIds
      .filter((issue) => dimension.includes(issue.dimension))
      .reduce((total, issue) => total + severityWeight(issue.severity), 0);

  const scores = {
    accessibility: clamp(100 - penalty(['accessibility']) * 9, 25, 100),
    ux: clamp(100 - penalty(['ux', 'hierarchy', 'cta', 'responsive']) * 7, 25, 100),
    content: clamp(100 - penalty(['content', 'clarity']) * 8, 25, 100),
    code: clamp(100 - penalty(['code']) * 9, 30, 100),
    design: clamp(100 - penalty(['visual-consistency', 'generic-patterns', 'subtractive']) * 7, 30, 100),
    overall: 0,
  };
  scores.overall = Math.round(
    (scores.accessibility + scores.ux + scores.content + scores.code + scores.design) / 5,
  );

  const priority = [...withIds]
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))
    .map((issue) => issue.id);

  const payload = {
    issues: withIds.map(({ id, dimension, severity, title, description, location }) => ({
      id,
      dimension,
      severity,
      title,
      description,
      location,
    })),
    suggestions: withIds.map((issue, index) => ({
      id: `suggestion-${index + 1}`,
      issueId: issue.id,
      dimension: issue.dimension,
      title: issue.title,
      action: issue.action,
      impact: issue.impact,
    })),
    priority,
    scores,
    refinementPrompt: buildRefinementPrompt(withIds),
  };

  return JSON.stringify(payload, null, 2);
}

function severityWeight(severity: CriticSeverity): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
}

function buildRefinementPrompt(issues: Array<RawIssue & { id: string }>): string {
  if (issues.length === 0) {
    return 'La auditoria automatica no encontro problemas bloqueantes. Revisa el copy a mano antes de publicar.';
  }
  const lines = issues
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))
    .map((issue, index) => `${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title}: ${issue.action}`);

  return [
    'Corrige la Landing Page aplicando exactamente estos cambios y nada mas:',
    '',
    ...lines,
    '',
    'Manten el resto del contenido, el tono y la identidad visual intactos.',
  ].join('\n');
}
