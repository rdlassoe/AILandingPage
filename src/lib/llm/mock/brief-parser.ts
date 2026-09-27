import type { SeedCategory } from '@/types/domain';

/**
 * Lector del prompt estructurado que produce el Prompt Engine.
 *
 * El Mock Provider no es un LLM: para generar una Landing Page coherente
 * necesita recuperar los datos del proyecto desde el propio prompt. Como el
 * formato lo emite esta misma aplicacion (`src/services/prompt-engine`), el
 * analisis es fiable: se leen lineas `- Campo: valor` dentro de cada bloque
 * `## SECCION`, con valores por defecto si algo falta.
 */

export interface MockBrief {
  name: string;
  theme: string;
  description: string;
  landingType: string;
  audience: string;
  goal: string;
  product: string;
  cta: string;
  style: string;
  colors: string[];
  typography: string;
  tone: string;
  keyMessage: string;
  features: string[];
  benefits: string[];
  sections: string[];
  seedValue: string;
  seedCategory: SeedCategory;
  negativeConstraints: string[];
  technologies: string[];
}

const DEFAULT_BRIEF: MockBrief = {
  name: 'Proyecto sin nombre',
  theme: 'producto digital',
  description: 'Una propuesta clara para un publico concreto.',
  landingType: 'saas',
  audience: 'equipos que necesitan resolver un problema concreto',
  goal: 'conseguir registros cualificados',
  product: 'el producto',
  cta: 'Empezar ahora',
  style: 'contemporaneo y sobrio',
  colors: [],
  typography: 'sans-serif de sistema',
  tone: 'directo',
  keyMessage: '',
  features: [],
  benefits: [],
  sections: [],
  seedValue: '',
  seedCategory: 'editorial',
  negativeConstraints: [],
  technologies: [],
};

/** Divide el prompt en bloques por cabecera `## TITULO`. */
function splitSections(prompt: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const lines = prompt.split(/\r?\n/);
  let current = 'PREAMBULO';
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      const previous = blocks.get(current) ?? '';
      blocks.set(current, `${previous}\n${buffer.join('\n')}`.trim());
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading && heading[1]) {
      flush();
      current = heading[1].trim().toUpperCase();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

/** Lee `- Campo: valor` dentro de un bloque. */
function field(block: string | undefined, label: string): string | null {
  if (!block) return null;
  const pattern = new RegExp(`^[-*]\\s*${escapeRegExp(label)}\\s*:\\s*(.+)$`, 'im');
  const match = pattern.exec(block);
  return match?.[1]?.trim() ?? null;
}

/** Lee la lista de vinetas de un bloque, ignorando pares `Campo: valor`. */
function bullets(block: string | undefined): string[] {
  if (!block) return [];
  return block
    .split(/\r?\n/)
    .map((line) => /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line)?.[1]?.trim() ?? '')
    .filter((line) => line.length > 0 && !/^[A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,28}:\s/.test(line));
}

function listField(block: string | undefined, label: string): string[] {
  const raw = field(block, label);
  if (!raw) return [];
  return raw
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '—');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SEED_KEYWORDS: Array<[SeedCategory, RegExp]> = [
  ['swiss', /suiz|swiss|grotesc|ret[ií]cula estricta/i],
  ['bauhaus', /bauhaus|geometr[ií]a primaria/i],
  ['brutalist', /brutal/i],
  ['industrial', /industrial|laboratorio|instrumenta/i],
  ['retro-tech', /retro|terminal|f[oó]sforo|computing|80/i],
  ['luxury', /lujo|luxury|premium|oro/i],
  ['architecture', /arquitect|hormig[oó]n|plano/i],
  ['documentary', /documental|fotograf[ií]a real|reportaje/i],
  ['magazine', /revista|magazine|editorial de portada/i],
  ['natural', /org[aá]nic|natural|vegetal|madera/i],
  ['experimental', /experimental|ret[ií]cula rota|collage/i],
  ['editorial', /editorial|tipograf[ií]a protagonista/i],
];

export function detectSeedCategory(seedValue: string): SeedCategory {
  for (const [category, pattern] of SEED_KEYWORDS) {
    if (pattern.test(seedValue)) return category;
  }
  return 'editorial';
}

export function parseBrief(prompt: string): MockBrief {
  const blocks = splitSections(prompt);
  const context = blocks.get('CONTEXT');
  const objective = blocks.get('OBJECTIVE');
  const audienceBlock = blocks.get('TARGET AUDIENCE');
  const businessBlock = blocks.get('BUSINESS GOAL');
  const visual = blocks.get('VISUAL DIRECTION');
  const seedBlock = blocks.get('SEED STRING');
  const iaBlock = blocks.get('INFORMATION ARCHITECTURE');
  const copyBlock = blocks.get('COPY REQUIREMENTS');
  const techBlock = blocks.get('TECHNOLOGY');
  const negativeBlock = blocks.get('NEGATIVE CONSTRAINTS');

  const seedValue = field(seedBlock, 'Seed') ?? firstLine(seedBlock) ?? DEFAULT_BRIEF.seedValue;

  const sections = bullets(iaBlock)
    .map((line) => line.replace(/\s*[—-].*$/, '').trim())
    .filter((line) => line.length > 0);

  return {
    name: field(context, 'Proyecto') ?? DEFAULT_BRIEF.name,
    theme: field(context, 'Tema') ?? DEFAULT_BRIEF.theme,
    description: field(context, 'Descripcion') ?? DEFAULT_BRIEF.description,
    landingType: field(context, 'Tipo de landing') ?? DEFAULT_BRIEF.landingType,
    product: field(context, 'Producto o servicio') ?? DEFAULT_BRIEF.product,
    audience: field(audienceBlock, 'Publico') ?? DEFAULT_BRIEF.audience,
    goal: field(businessBlock, 'Objetivo de negocio') ?? field(objective, 'Objetivo') ?? DEFAULT_BRIEF.goal,
    cta: field(businessBlock, 'CTA principal') ?? DEFAULT_BRIEF.cta,
    style: field(visual, 'Estilo') ?? DEFAULT_BRIEF.style,
    colors: listField(visual, 'Colores'),
    typography: field(visual, 'Tipografia') ?? DEFAULT_BRIEF.typography,
    tone: field(copyBlock, 'Tono') ?? DEFAULT_BRIEF.tone,
    keyMessage: field(copyBlock, 'Mensaje principal') ?? '',
    features: listField(copyBlock, 'Caracteristicas'),
    benefits: listField(copyBlock, 'Beneficios'),
    sections: sections.length > 0 ? sections : DEFAULT_BRIEF.sections,
    seedValue,
    seedCategory: detectSeedCategory(seedValue),
    negativeConstraints: bullets(negativeBlock),
    technologies: listField(techBlock, 'Stack'),
  };
}

function firstLine(block: string | undefined): string | null {
  if (!block) return null;
  const line = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? null;
}
