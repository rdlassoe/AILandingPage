import type { MockBrief } from './brief-parser';
import { escapeHtml } from '@/lib/utils';
import type { SeedCategory } from '@/types/domain';

/**
 * MockLandingGenerator
 *
 * Produce un documento HTML autocontenido, semantico, responsive y accesible
 * a partir del brief extraido del prompt. NO llama a ningun modelo: es la
 * pieza que permite recorrer el flujo completo (generar, validar, previsualizar,
 * criticar, refinar, versionar, guardar) sin ninguna API de pago.
 *
 * La pagina resultante se marca siempre como generada en modo demo, tanto en
 * los metadatos del documento como en la interfaz de la aplicacion.
 */

interface StylePreset {
  fontHeading: string;
  fontBody: string;
  fontMono: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  border: string;
  radius: string;
  borderWidth: string;
  headingTransform: string;
  headingSpacing: string;
  headingWeight: string;
  maxWidth: string;
  sectionGap: string;
  eyebrowStyle: string;
  heroLayout: 'split' | 'stacked' | 'centered';
}

const GROTESQUE = "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif";
const GEOMETRIC = "'Futura', 'Century Gothic', 'Avenir Next', system-ui, sans-serif";
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const MONO = "'SFMono-Regular', ui-monospace, Consolas, 'Liberation Mono', monospace";

const PRESETS: Record<SeedCategory, StylePreset> = {
  swiss: {
    fontHeading: GROTESQUE,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#ffffff',
    surface: '#f4f4f2',
    text: '#111111',
    muted: '#5b5b5b',
    accent: '#d0342c',
    accentText: '#ffffff',
    border: '#111111',
    radius: '0px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.03em',
    headingWeight: '700',
    maxWidth: '1180px',
    sectionGap: '7rem',
    eyebrowStyle: 'letter-spacing:.18em;text-transform:uppercase;font-size:.72rem',
    heroLayout: 'split',
  },
  bauhaus: {
    fontHeading: GEOMETRIC,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#f2efe9',
    surface: '#ffffff',
    text: '#141414',
    muted: '#4a4a4a',
    accent: '#e03616',
    accentText: '#ffffff',
    border: '#141414',
    radius: '0px',
    borderWidth: '2px',
    headingTransform: 'uppercase',
    headingSpacing: '0.01em',
    headingWeight: '700',
    maxWidth: '1140px',
    sectionGap: '6rem',
    eyebrowStyle: 'letter-spacing:.2em;text-transform:uppercase;font-size:.7rem',
    heroLayout: 'split',
  },
  brutalist: {
    fontHeading: GROTESQUE,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#ffffff',
    surface: '#ffed4a',
    text: '#000000',
    muted: '#333333',
    accent: '#0026ff',
    accentText: '#ffffff',
    border: '#000000',
    radius: '0px',
    borderWidth: '3px',
    headingTransform: 'uppercase',
    headingSpacing: '-0.02em',
    headingWeight: '800',
    maxWidth: '1100px',
    sectionGap: '5rem',
    eyebrowStyle: 'letter-spacing:.12em;text-transform:uppercase;font-size:.75rem',
    heroLayout: 'stacked',
  },
  industrial: {
    fontHeading: GROTESQUE,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#14171a',
    surface: '#1c2126',
    text: '#e9edf0',
    muted: '#9aa5ad',
    accent: '#f0a500',
    accentText: '#14171a',
    border: '#2e363d',
    radius: '2px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.01em',
    headingWeight: '600',
    maxWidth: '1200px',
    sectionGap: '6rem',
    eyebrowStyle: 'letter-spacing:.22em;text-transform:uppercase;font-size:.68rem;font-family:var(--font-mono)',
    heroLayout: 'split',
  },
  'retro-tech': {
    fontHeading: MONO,
    fontBody: MONO,
    fontMono: MONO,
    bg: '#0b0f0b',
    surface: '#111a11',
    text: '#d7ffd9',
    muted: '#7fae84',
    accent: '#38f06a',
    accentText: '#06120a',
    border: '#2a4a2f',
    radius: '0px',
    borderWidth: '1px',
    headingTransform: 'uppercase',
    headingSpacing: '0.04em',
    headingWeight: '700',
    maxWidth: '1060px',
    sectionGap: '5rem',
    eyebrowStyle: 'letter-spacing:.24em;text-transform:uppercase;font-size:.7rem',
    heroLayout: 'stacked',
  },
  luxury: {
    fontHeading: SERIF,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#0d0d0c',
    surface: '#161614',
    text: '#f3efe7',
    muted: '#a49c8d',
    accent: '#c9a227',
    accentText: '#141310',
    border: '#2c2a26',
    radius: '0px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.01em',
    headingWeight: '400',
    maxWidth: '1000px',
    sectionGap: '9rem',
    eyebrowStyle: 'letter-spacing:.32em;text-transform:uppercase;font-size:.68rem',
    heroLayout: 'centered',
  },
  architecture: {
    fontHeading: GROTESQUE,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#f6f6f4',
    surface: '#ffffff',
    text: '#1b1b1b',
    muted: '#6a6a68',
    accent: '#2f4858',
    accentText: '#ffffff',
    border: '#d5d5d0',
    radius: '0px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.02em',
    headingWeight: '500',
    maxWidth: '1160px',
    sectionGap: '7rem',
    eyebrowStyle: 'letter-spacing:.2em;text-transform:uppercase;font-size:.7rem;font-family:var(--font-mono)',
    heroLayout: 'split',
  },
  documentary: {
    fontHeading: SERIF,
    fontBody: SERIF,
    fontMono: MONO,
    bg: '#faf8f5',
    surface: '#ffffff',
    text: '#22201d',
    muted: '#6b645c',
    accent: '#8a5a33',
    accentText: '#ffffff',
    border: '#e2dcd3',
    radius: '2px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.015em',
    headingWeight: '600',
    maxWidth: '980px',
    sectionGap: '6.5rem',
    eyebrowStyle: 'letter-spacing:.16em;text-transform:uppercase;font-size:.7rem;font-family:var(--font-mono)',
    heroLayout: 'stacked',
  },
  magazine: {
    fontHeading: SERIF,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#fffdf8',
    surface: '#f3ece1',
    text: '#1a1714',
    muted: '#615a51',
    accent: '#b3311f',
    accentText: '#ffffff',
    border: '#1a1714',
    radius: '0px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.025em',
    headingWeight: '700',
    maxWidth: '1120px',
    sectionGap: '6rem',
    eyebrowStyle: 'letter-spacing:.18em;text-transform:uppercase;font-size:.7rem',
    heroLayout: 'split',
  },
  natural: {
    fontHeading: GROTESQUE,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#f7f5f0',
    surface: '#ffffff',
    text: '#23281f',
    muted: '#5f6b58',
    accent: '#4a6b3f',
    accentText: '#ffffff',
    border: '#dcdcd2',
    radius: '14px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.02em',
    headingWeight: '600',
    maxWidth: '1120px',
    sectionGap: '6.5rem',
    eyebrowStyle: 'letter-spacing:.14em;text-transform:uppercase;font-size:.72rem',
    heroLayout: 'split',
  },
  experimental: {
    fontHeading: GROTESQUE,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#ece9e4',
    surface: '#ffffff',
    text: '#101010',
    muted: '#4f4f4f',
    accent: '#ff3d2e',
    accentText: '#ffffff',
    border: '#101010',
    radius: '0px',
    borderWidth: '2px',
    headingTransform: 'none',
    headingSpacing: '-0.045em',
    headingWeight: '800',
    maxWidth: '1180px',
    sectionGap: '5.5rem',
    eyebrowStyle: 'letter-spacing:.2em;text-transform:uppercase;font-size:.7rem',
    heroLayout: 'stacked',
  },
  art: {
    fontHeading: SERIF,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#f4f1ec',
    surface: '#ffffff',
    text: '#141210',
    muted: '#5a544c',
    accent: '#1f3a93',
    accentText: '#ffffff',
    border: '#141210',
    radius: '0px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.02em',
    headingWeight: '500',
    maxWidth: '1080px',
    sectionGap: '7.5rem',
    eyebrowStyle: 'letter-spacing:.24em;text-transform:uppercase;font-size:.68rem',
    heroLayout: 'centered',
  },
  editorial: {
    fontHeading: SERIF,
    fontBody: GROTESQUE,
    fontMono: MONO,
    bg: '#fbfaf8',
    surface: '#ffffff',
    text: '#17181a',
    muted: '#5d6066',
    accent: '#1f4fd8',
    accentText: '#ffffff',
    border: '#e0dfdb',
    radius: '4px',
    borderWidth: '1px',
    headingTransform: 'none',
    headingSpacing: '-0.03em',
    headingWeight: '600',
    maxWidth: '1140px',
    sectionGap: '7rem',
    eyebrowStyle: 'letter-spacing:.18em;text-transform:uppercase;font-size:.72rem',
    heroLayout: 'split',
  },
};

/** Sustituye los colores del preset por los que pidio el usuario. */
function applyBriefColors(preset: StylePreset, colors: string[]): StylePreset {
  const hexes = colors.filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()));
  if (hexes.length === 0) return preset;
  const [first, second] = hexes;
  return {
    ...preset,
    accent: first ?? preset.accent,
    border: second ?? preset.border,
  };
}

function pick<T>(items: T[], index: number, fallback: T): T {
  return items[index] ?? fallback;
}

function sectionRequested(brief: MockBrief, keywords: string[], whenEmpty: boolean): boolean {
  if (brief.sections.length === 0) return whenEmpty;
  const normalized = brief.sections.map((s) => s.toLowerCase());
  return normalized.some((section) => keywords.some((keyword) => section.includes(keyword)));
}

interface Copy {
  eyebrow: string;
  headline: string;
  subhead: string;
  ctaPrimary: string;
  ctaSecondary: string;
  valueTitle: string;
  valueBody: string;
  features: Array<{ title: string; body: string }>;
  steps: Array<{ title: string; body: string }>;
  benefits: string[];
  metrics: Array<{ value: string; label: string }>;
  faqs: Array<{ q: string; a: string }>;
  closingTitle: string;
  closingBody: string;
}

function buildCopy(brief: MockBrief): Copy {
  const product = brief.product && brief.product !== 'el producto' ? brief.product : brief.name;
  const audience = brief.audience;

  const featureSource = brief.features.length > 0 ? brief.features : [];
  const benefitSource = brief.benefits.length > 0 ? brief.benefits : [];

  const features = (featureSource.length > 0
    ? featureSource
    : [
        'Puesta en marcha en una tarde',
        'Todo el historial en un solo sitio',
        'Exportacion sin bloqueos',
        'Permisos por equipo',
      ]
  )
    .slice(0, 6)
    .map((title, index) => ({
      title,
      body: featureBody(title, product, audience, index),
    }));

  const benefits = (benefitSource.length > 0
    ? benefitSource
    : [
        `Menos tiempo de coordinacion para ${audience}`,
        'Decisiones basadas en datos que ya teneis',
        'Un unico origen de verdad, sin hojas de calculo paralelas',
      ]
  ).slice(0, 5);

  const headline = brief.keyMessage.trim().length > 0
    ? brief.keyMessage.trim()
    : `${capitalize(product)} para ${audience}`;

  return {
    eyebrow: brief.theme,
    headline,
    subhead: brief.description,
    ctaPrimary: brief.cta,
    ctaSecondary: 'Ver como funciona',
    valueTitle: 'El problema, dicho sin rodeos',
    valueBody: `${capitalize(audience)} pierden horas cada semana resolviendo a mano lo que ${product} resuelve una sola vez. Esta pagina explica que hace, para quien y que pasa despues de pulsar "${brief.cta}".`,
    features,
    benefits,
    steps: [
      {
        title: 'Conectas lo que ya usas',
        body: 'Sin migraciones ni proyectos de seis meses: se parte de los datos que ya existen.',
      },
      {
        title: 'Defines las reglas una vez',
        body: `Se traducen las decisiones que ${audience} ya toman a mano en criterios explicitos.`,
      },
      {
        title: 'El sistema mantiene el orden',
        body: 'Cada cambio queda registrado y es reversible. Nadie tiene que acordarse de nada.',
      },
    ],
    metrics: [
      { value: '4 h', label: 'ahorradas por persona y semana' },
      { value: '1 dia', label: 'de puesta en marcha' },
      { value: '100 %', label: 'de los datos exportables' },
    ],
    faqs: [
      {
        q: `¿Que necesito para empezar con ${product}?`,
        a: 'Una cuenta y los datos que ya manejais. No hace falta instalar nada en local ni contratar integracion.',
      },
      {
        q: '¿Que pasa con mis datos si dejo de usarlo?',
        a: 'Se exportan en formatos abiertos cuando quieras. No hay periodo de retencion forzoso ni formatos propietarios.',
      },
      {
        q: '¿Como se factura?',
        a: 'Por uso real y con un limite que defines tu. Si un mes no se usa, ese mes no se factura.',
      },
      {
        q: `¿Esto sirve para ${audience}?`,
        a: `Esta pensado exactamente para ese caso. Si tu situacion es distinta, escribenos antes de contratar y te decimos si encaja.`,
      },
    ],
    closingTitle: brief.goal ? capitalize(brief.goal) : 'Da el siguiente paso',
    closingBody: `Sin tarjeta, sin llamada comercial. Si en quince minutos ${product} no te encaja, lo sabras.`,
  };
}

function featureBody(title: string, product: string, audience: string, index: number): string {
  const templates = [
    `${capitalize(title)} sin configuracion previa: funciona desde el primer dia con lo que ya teneis.`,
    `Lo que ${audience} hacian a mano, ${product} lo deja resuelto y documentado.`,
    'Cada cambio queda registrado, con autor y fecha, y se puede revertir.',
    'Se integra con el resto del flujo sin obligar a cambiar de herramienta.',
    'Pensado para usarse a diario, no para una demo.',
    'Los limites y los permisos se definen por equipo, no por usuario.',
  ];
  return pick(templates, index, templates[0] as string);
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const ICONS: Record<string, string> = {
  check:
    '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
};

function icon(name: keyof typeof ICONS): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.check}</svg>`;
}

const FEATURE_ICONS: Array<keyof typeof ICONS> = ['layers', 'clock', 'shield', 'grid', 'check', 'arrow'];

/**
 * Mejoras que el refinamiento puede activar.
 *
 * Existen para que el bucle GENERATE -> CRITIQUE -> REFINE funcione de verdad
 * en modo demo: el critico detecta estas carencias y, si el usuario acepta las
 * recomendaciones, el generador las aplica en la version siguiente.
 */
export interface MockLandingOptions {
  openGraph: boolean;
  structuredData: boolean;
  formPrivacyNote: boolean;
  illustration: boolean;
  favicon: boolean;
}

export const DEFAULT_MOCK_OPTIONS: MockLandingOptions = {
  openGraph: false,
  structuredData: false,
  formPrivacyNote: false,
  illustration: false,
  favicon: false,
};

export function generateMockLanding(
  brief: MockBrief,
  options: MockLandingOptions = DEFAULT_MOCK_OPTIONS,
): string {
  const preset = applyBriefColors(PRESETS[brief.seedCategory] ?? PRESETS.editorial, brief.colors);
  const copy = buildCopy(brief);

  const showFeatures = sectionRequested(brief, ['caracter', 'feature', 'funcional'], true);
  const showSteps = sectionRequested(brief, ['como funciona', 'proceso', 'pasos', 'how'], true);
  const showBenefits = sectionRequested(brief, ['beneficio', 'valor', 'ventaja'], true);
  const showMetrics = sectionRequested(brief, ['dato', 'resultado', 'prueba', 'metric', 'social'], true);
  const showFaq = sectionRequested(brief, ['faq', 'pregunta', 'duda'], true);

  const e = escapeHtml;
  const title = `${e(copy.headline)} | ${e(brief.name)}`;
  const description = e(copy.subhead).slice(0, 155);

  const navItems = [
    showFeatures ? ['#caracteristicas', 'Caracteristicas'] : null,
    showSteps ? ['#como-funciona', 'Como funciona'] : null,
    showBenefits ? ['#beneficios', 'Beneficios'] : null,
    showFaq ? ['#preguntas', 'Preguntas'] : null,
  ].filter((item): item is [string, string] => item !== null);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="generator" content="AI Landing Studio - Demo Mode (sin proveedor LLM)">
${options.favicon ? faviconTag(preset) : ''}${options.openGraph ? openGraphTags(title, description, brief) : ''}${options.structuredData ? structuredDataTag(brief, copy) : ''}
<style>
/* ---------- tokens ---------- */
:root{
  --bg:${preset.bg};
  --surface:${preset.surface};
  --text:${preset.text};
  --muted:${preset.muted};
  --accent:${preset.accent};
  --accent-text:${preset.accentText};
  --border:${preset.border};
  --radius:${preset.radius};
  --border-width:${preset.borderWidth};
  --font-heading:${preset.fontHeading};
  --font-body:${preset.fontBody};
  --font-mono:${preset.fontMono};
  --max-width:${preset.maxWidth};
  --section-gap:${preset.sectionGap};
  --space-1:.5rem; --space-2:1rem; --space-3:1.5rem; --space-4:2.5rem; --space-5:4rem;
}

/* ---------- base ---------- */
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;background:var(--bg);color:var(--text);
  font-family:var(--font-body);font-size:1rem;line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
h1,h2,h3{
  font-family:var(--font-heading);font-weight:${preset.headingWeight};
  letter-spacing:${preset.headingSpacing};text-transform:${preset.headingTransform};
  line-height:1.08;margin:0 0 var(--space-2);
}
h1{font-size:clamp(2.4rem,6vw,4.2rem)}
h2{font-size:clamp(1.7rem,3.6vw,2.6rem)}
h3{font-size:1.125rem;line-height:1.3}
p{margin:0 0 var(--space-2);max-width:65ch}
a{color:inherit}
img{max-width:100%;display:block}
ul{margin:0;padding:0;list-style:none}
.icon{width:20px;height:20px;flex:none}

.wrap{width:100%;max-width:var(--max-width);margin-inline:auto;padding-inline:1.25rem}
.eyebrow{${preset.eyebrowStyle};color:var(--accent);margin:0 0 var(--space-2);display:block}
.muted{color:var(--muted)}
.lead{font-size:1.125rem;color:var(--muted);max-width:56ch}

:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.skip{position:absolute;left:-9999px;top:0;background:var(--accent);color:var(--accent-text);padding:.75rem 1rem;z-index:100}
.skip:focus{left:0}

/* ---------- botones ---------- */
.btn{
  display:inline-flex;align-items:center;gap:.5rem;
  padding:.85rem 1.4rem;border:var(--border-width) solid var(--border);
  border-radius:var(--radius);font:inherit;font-weight:600;cursor:pointer;
  text-decoration:none;background:transparent;color:var(--text);
  transition:background .15s ease,color .15s ease;
}
.btn--primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
.btn--primary:hover{filter:brightness(.92)}
.btn--ghost:hover{background:var(--surface)}

/* ---------- cabecera ---------- */
.site-header{
  position:sticky;top:0;z-index:20;background:var(--bg);
  border-bottom:var(--border-width) solid var(--border);
}
.site-header__inner{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);min-height:64px}
.brand{font-family:var(--font-heading);font-weight:700;letter-spacing:-.02em;font-size:1.05rem;text-decoration:none}
.nav{display:none}
.nav ul{display:flex;gap:var(--space-3);align-items:center}
.nav a{text-decoration:none;font-size:.95rem;color:var(--muted)}
.nav a:hover{color:var(--text)}
.nav-toggle{display:inline-flex;align-items:center;gap:.5rem;background:transparent;border:var(--border-width) solid var(--border);border-radius:var(--radius);padding:.55rem .8rem;font:inherit;cursor:pointer;color:inherit}
.mobile-nav{display:none;border-top:var(--border-width) solid var(--border);padding:var(--space-2) 0}
.mobile-nav[data-open="true"]{display:block}
.mobile-nav ul{display:grid;gap:.25rem}
.mobile-nav a{display:block;padding:.7rem 0;text-decoration:none;border-bottom:1px solid var(--border)}

/* ---------- secciones ---------- */
section{padding-block:var(--section-gap)}
.section-head{margin-bottom:var(--space-4);max-width:58ch}

/* ---------- hero ---------- */
.hero{padding-top:calc(var(--section-gap) * .8);border-bottom:var(--border-width) solid var(--border)}
.hero__grid{display:grid;gap:var(--space-4)}
.hero__actions{display:flex;flex-wrap:wrap;gap:var(--space-1);margin-top:var(--space-3)}
.hero__panel{border:var(--border-width) solid var(--border);border-radius:var(--radius);background:var(--surface);padding:var(--space-3)}
.hero__panel dl{display:grid;gap:var(--space-2);margin:0}
.hero__panel dt{font-family:var(--font-mono);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.hero__panel dd{margin:.25rem 0 0;font-size:1rem}

/* ---------- retículas ---------- */
.grid{display:grid;gap:var(--space-3)}
.feature{border-top:var(--border-width) solid var(--border);padding-top:var(--space-2)}
.feature__top{display:flex;align-items:center;gap:.6rem;color:var(--accent);margin-bottom:.4rem}
.feature p{color:var(--muted);margin:0}

.steps{counter-reset:step;display:grid;gap:var(--space-3)}
.step{display:grid;grid-template-columns:auto 1fr;gap:var(--space-2);align-items:start}
.step__num{counter-increment:step;font-family:var(--font-mono);font-size:.8rem;border:var(--border-width) solid var(--border);border-radius:var(--radius);width:2.25rem;height:2.25rem;display:grid;place-items:center}
.step__num::before{content:"0" counter(step)}
.step p{color:var(--muted);margin:.25rem 0 0}

.benefits li{display:flex;gap:.75rem;align-items:flex-start;padding:.75rem 0;border-bottom:1px solid var(--border)}
.benefits .icon{color:var(--accent);margin-top:.15rem}

.metrics{display:grid;gap:var(--space-2);border-block:var(--border-width) solid var(--border);padding-block:var(--space-4)}
.metric__value{font-family:var(--font-heading);font-size:clamp(2rem,5vw,3rem);line-height:1;display:block}
.metric__label{color:var(--muted);font-size:.9rem}

/* ---------- FAQ ---------- */
.faq{display:grid;gap:0;max-width:52rem}
.faq__item{border-bottom:1px solid var(--border)}
.faq__btn{width:100%;display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);background:none;border:0;padding:1.15rem 0;font:inherit;font-weight:600;text-align:left;cursor:pointer;color:inherit}
.faq__sign{font-family:var(--font-mono);color:var(--accent);flex:none}
.faq__panel{display:none;padding-bottom:1.15rem}
.faq__panel[data-open="true"]{display:block}
.faq__panel p{color:var(--muted);margin:0}

/* ---------- CTA ---------- */
.cta{background:var(--surface);border-top:var(--border-width) solid var(--border)}
.cta__form{display:grid;gap:.75rem;max-width:30rem;margin-top:var(--space-3)}
.field{display:grid;gap:.35rem}
.field label{font-size:.85rem;font-weight:600}
.field input{
  font:inherit;padding:.8rem .9rem;border:var(--border-width) solid var(--border);
  border-radius:var(--radius);background:var(--bg);color:var(--text);width:100%;
}
.field input[aria-invalid="true"]{border-color:var(--accent)}
.field__error{font-size:.82rem;color:var(--accent);min-height:1.2em}
.form__status{font-size:.9rem;margin-top:.25rem}
.form__note{font-size:.82rem;color:var(--muted);margin:.35rem 0 0}
.hero__diagram{margin-top:var(--space-3);border-top:1px solid var(--border);padding-top:var(--space-2)}
.hero__diagram svg{width:100%;height:auto;display:block}

/* ---------- pie ---------- */
.site-footer{border-top:var(--border-width) solid var(--border);padding-block:var(--space-4);font-size:.9rem;color:var(--muted)}
.site-footer__inner{display:grid;gap:var(--space-2)}
.demo-note{font-family:var(--font-mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}

/* ---------- responsive ---------- */
@media (min-width:768px){
  .grid--3{grid-template-columns:repeat(3,1fr)}
  .grid--2{grid-template-columns:repeat(2,1fr)}
  .metrics{grid-template-columns:repeat(3,1fr)}
  .steps{grid-template-columns:repeat(3,1fr)}
  .site-footer__inner{grid-template-columns:1fr auto;align-items:center}
}
@media (min-width:960px){
  .nav{display:block}
  .nav-toggle{display:none}
  .mobile-nav{display:none !important}
  ${preset.heroLayout === 'split' ? '.hero__grid{grid-template-columns:1.35fr .65fr;align-items:start;gap:var(--space-5)}' : ''}
  ${preset.heroLayout === 'centered' ? '.hero__grid{justify-items:center;text-align:center}.hero p,.hero .lead{margin-inline:auto}.hero__actions{justify-content:center}' : ''}
}
@media (prefers-reduced-motion:reduce){
  *{animation:none !important;transition:none !important}
  html{scroll-behavior:auto}
}
</style>
</head>
<body>
<a class="skip" href="#contenido">Saltar al contenido</a>

<header class="site-header">
  <div class="wrap site-header__inner">
    <a class="brand" href="#contenido">${e(brief.name)}</a>
    <nav class="nav" aria-label="Principal">
      <ul>
        ${navItems.map(([href, label]) => `<li><a href="${href}">${e(label)}</a></li>`).join('\n        ')}
        <li><a class="btn btn--primary" href="#empezar">${e(copy.ctaPrimary)}</a></li>
      </ul>
    </nav>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="menu-movil" id="nav-toggle">
      Menu
    </button>
  </div>
  <div class="wrap mobile-nav" id="menu-movil" data-open="false">
    <ul>
      ${navItems.map(([href, label]) => `<li><a href="${href}">${e(label)}</a></li>`).join('\n      ')}
      <li><a href="#empezar">${e(copy.ctaPrimary)}</a></li>
    </ul>
  </div>
</header>

<main id="contenido">

  <section class="hero">
    <div class="wrap hero__grid">
      <div>
        <span class="eyebrow">${e(copy.eyebrow)}</span>
        <h1>${e(copy.headline)}</h1>
        <p class="lead">${e(copy.subhead)}</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="#empezar">${e(copy.ctaPrimary)} ${icon('arrow')}</a>
          <a class="btn btn--ghost" href="#como-funciona">${e(copy.ctaSecondary)}</a>
        </div>
      </div>
      <aside class="hero__panel" aria-label="Resumen del proyecto">
        <dl>
          <div><dt>Para quien</dt><dd>${e(brief.audience)}</dd></div>
          <div><dt>Que resuelve</dt><dd>${e(brief.theme)}</dd></div>
          <div><dt>Direccion visual</dt><dd>${e(brief.style)}</dd></div>
        </dl>
        ${options.illustration ? heroDiagram(preset) : ''}
      </aside>
    </div>
  </section>

  <section id="propuesta">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Propuesta de valor</span>
        <h2>${e(copy.valueTitle)}</h2>
      </div>
      <p>${e(copy.valueBody)}</p>
    </div>
  </section>

${showFeatures ? featuresSection(copy, e) : ''}
${showSteps ? stepsSection(copy, e) : ''}
${showBenefits ? benefitsSection(copy, e) : ''}
${showMetrics ? metricsSection(copy, e) : ''}
${showFaq ? faqSection(copy, e) : ''}

  <section class="cta" id="empezar">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Siguiente paso</span>
        <h2>${e(copy.closingTitle)}</h2>
        <p class="lead">${e(copy.closingBody)}</p>
      </div>
      <form class="cta__form" id="form-alta" novalidate>
        <div class="field">
          <label for="email">Correo de trabajo</label>
          <input type="email" id="email" name="email" autocomplete="email" required
                 aria-describedby="email-error" placeholder="nombre@empresa.com">
          <span class="field__error" id="email-error" role="alert"></span>
        </div>
        <button class="btn btn--primary" type="submit">${e(copy.ctaPrimary)}</button>
        <p class="form__status" id="form-status" role="status" aria-live="polite"></p>
        ${options.formPrivacyNote ? `<p class="form__note">Solo usamos el correo para enviarte el acceso. Ni newsletter ni terceros, y puedes darte de baja desde el primer mensaje.</p>` : ''}
      </form>
    </div>
  </section>

</main>

<footer class="site-footer">
  <div class="wrap site-footer__inner">
    <p style="margin:0">${e(brief.name)} &middot; ${e(brief.theme)}</p>
    <p class="demo-note" style="margin:0">Generado en modo demo &middot; sin proveedor LLM</p>
  </div>
</footer>

<script>
(function () {
  'use strict';

  // Menu movil
  var toggle = document.getElementById('nav-toggle');
  var menu = document.getElementById('menu-movil');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.getAttribute('data-open') === 'true';
      menu.setAttribute('data-open', String(!open));
      toggle.setAttribute('aria-expanded', String(!open));
    });
    menu.addEventListener('click', function (event) {
      if (event.target && event.target.tagName === 'A') {
        menu.setAttribute('data-open', 'false');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Acordeon de preguntas
  var buttons = document.querySelectorAll('.faq__btn');
  Array.prototype.forEach.call(buttons, function (button) {
    button.addEventListener('click', function () {
      var panel = document.getElementById(button.getAttribute('aria-controls'));
      if (!panel) return;
      var open = panel.getAttribute('data-open') === 'true';
      panel.setAttribute('data-open', String(!open));
      button.setAttribute('aria-expanded', String(!open));
      var sign = button.querySelector('.faq__sign');
      if (sign) sign.textContent = open ? '+' : '−';
    });
  });

  // Validacion del formulario (sin backend: feedback explicito en cliente)
  var form = document.getElementById('form-alta');
  if (form) {
    var input = document.getElementById('email');
    var error = document.getElementById('email-error');
    var status = document.getElementById('form-status');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = (input.value || '').trim();
      var valid = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(value);

      input.setAttribute('aria-invalid', String(!valid));
      error.textContent = valid ? '' : 'Escribe un correo valido, por ejemplo nombre@empresa.com.';

      if (!valid) {
        input.focus();
        status.textContent = '';
        return;
      }

      status.textContent = 'Demostracion: el correo ' + value + ' no se envia a ningun servidor.';
      form.reset();
      input.setAttribute('aria-invalid', 'false');
    });
  }
})();
</script>
</body>
</html>`;
}

type Escaper = (value: string) => string;

function featuresSection(copy: Copy, e: Escaper): string {
  return `  <section id="caracteristicas">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Caracteristicas</span>
        <h2>Lo que hace, sin adornos</h2>
      </div>
      <div class="grid grid--3">
        ${copy.features
          .map(
            (feature, index) => `<article class="feature">
          <div class="feature__top">${icon(pick(FEATURE_ICONS, index, 'check'))}</div>
          <h3>${e(feature.title)}</h3>
          <p>${e(feature.body)}</p>
        </article>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>
`;
}

function stepsSection(copy: Copy, e: Escaper): string {
  return `  <section id="como-funciona">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Como funciona</span>
        <h2>Tres pasos, ninguno oculto</h2>
      </div>
      <div class="steps">
        ${copy.steps
          .map(
            (step) => `<article class="step">
          <span class="step__num" aria-hidden="true"></span>
          <div>
            <h3>${e(step.title)}</h3>
            <p>${e(step.body)}</p>
          </div>
        </article>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>
`;
}

function benefitsSection(copy: Copy, e: Escaper): string {
  return `  <section id="beneficios">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Beneficios</span>
        <h2>Que cambia a partir de la primera semana</h2>
      </div>
      <ul class="benefits">
        ${copy.benefits.map((benefit) => `<li>${icon('check')}<span>${e(benefit)}</span></li>`).join('\n        ')}
      </ul>
    </div>
  </section>
`;
}

function metricsSection(copy: Copy, e: Escaper): string {
  return `  <section id="datos">
    <div class="wrap">
      <div class="metrics">
        ${copy.metrics
          .map(
            (metric) => `<div class="metric">
          <span class="metric__value">${e(metric.value)}</span>
          <span class="metric__label">${e(metric.label)}</span>
        </div>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>
`;
}

function faqSection(copy: Copy, e: Escaper): string {
  return `  <section id="preguntas">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Preguntas</span>
        <h2>Lo que suelen preguntar antes de decidir</h2>
      </div>
      <div class="faq">
        ${copy.faqs
          .map(
            (faq, index) => `<div class="faq__item">
          <h3 style="margin:0">
            <button class="faq__btn" type="button" aria-expanded="false" aria-controls="faq-panel-${index}" id="faq-btn-${index}">
              <span>${e(faq.q)}</span><span class="faq__sign" aria-hidden="true">+</span>
            </button>
          </h3>
          <div class="faq__panel" id="faq-panel-${index}" role="region" aria-labelledby="faq-btn-${index}" data-open="false">
            <p>${e(faq.a)}</p>
          </div>
        </div>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>
`;
}

/* -------------------------------------------------------------------------
 * Bloques opcionales que activa el refinamiento
 * ---------------------------------------------------------------------- */

function faviconTag(preset: StylePreset): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" fill="${preset.accent}"/>` +
    `<rect x="7" y="7" width="18" height="18" fill="none" stroke="${preset.accentText}" stroke-width="2"/>` +
    `</svg>`;
  return `\n<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">\n<meta name="theme-color" content="${preset.accent}">`;
}

function openGraphTags(title: string, description: string, brief: MockBrief): string {
  const e = escapeHtml;
  return [
    '',
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:site_name" content="${e(brief.name)}">`,
    `<meta property="og:locale" content="es_ES">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
  ].join('\n');
}

function structuredDataTag(brief: MockBrief, copy: Copy): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: brief.name,
    description: copy.subhead,
    about: brief.theme,
    audience: { '@type': 'Audience', audienceType: brief.audience },
    mainEntity: {
      '@type': 'FAQPage',
      mainEntity: copy.faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.q,
        acceptedAnswer: { '@type': 'Answer', text: faq.a },
      })),
    },
  };
  // JSON.stringify ya escapa comillas; se neutraliza </script> por seguridad.
  const json = JSON.stringify(payload).replace(/<\//g, '<\/');
  return `\n<script type="application/ld+json">${json}</script>`;
}

/**
 * Diagrama de apoyo. Es un SVG inline con rol de imagen y texto alternativo,
 * no un adorno: resume el flujo de trabajo descrito en la pagina.
 */
function heroDiagram(preset: StylePreset): string {
  return `<div class="hero__diagram">
          <svg viewBox="0 0 320 96" role="img" aria-label="Diagrama: los datos de entrada pasan por el sistema y producen un plan revisable.">
            <rect x="1" y="26" width="86" height="44" fill="none" stroke="${preset.border}" stroke-width="1"/>
            <rect x="117" y="14" width="86" height="68" fill="${preset.accent}" opacity="0.12"/>
            <rect x="117" y="14" width="86" height="68" fill="none" stroke="${preset.accent}" stroke-width="1.5"/>
            <rect x="233" y="26" width="86" height="44" fill="none" stroke="${preset.border}" stroke-width="1"/>
            <path d="M87 48h30M203 48h30" stroke="${preset.accent}" stroke-width="1.5"/>
            <path d="m112 44 5 4-5 4M228 44l5 4-5 4" fill="none" stroke="${preset.accent}" stroke-width="1.5"/>
            <text x="44" y="52" text-anchor="middle" font-family="${preset.fontMono}" font-size="9" fill="${preset.muted}">ENTRADA</text>
            <text x="160" y="52" text-anchor="middle" font-family="${preset.fontMono}" font-size="9" fill="${preset.accent}">PROCESO</text>
            <text x="276" y="52" text-anchor="middle" font-family="${preset.fontMono}" font-size="9" fill="${preset.muted}">PLAN</text>
          </svg>
        </div>`;
}
