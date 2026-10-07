import { SECTION_ORDER, SECTION_TITLES } from './sections';
import type { PromptSection, PromptSectionId } from '@/types/domain';
import type { DesignTechniqueId } from '@/types/services';

/**
 * Lo que se hace con la respuesta del modelo que reescribe el borrador.
 *
 * Es logica pura, sin `server-only` ni llamadas al modelo, para poder
 * ejecutarla con respuestas simuladas (`npm run verify:prompt`). Aqui vive la
 * garantia de que el prompt final contiene UNICAMENTE las tecnicas de diseno
 * que eligio el usuario: no depende de que el modelo obedezca la peticion, se
 * impone sobre lo que devuelva.
 *
 *   1. Las secciones que el borrador no traia se descartan (un modelo que lee
 *      "escribe las 17 secciones" inventa SUBTRACTIVE DESIGN o SEED STRING).
 *   2. Las secciones "de sistema" (`VERBATIM_SECTIONS`) se restauran del
 *      borrador tal cual: lo que escriba el modelo ahi se ignora. Es lo que
 *      deja intactas las tecnicas elegidas.
 *   3. El resto no puede reproducir el texto de una tecnica NO elegida.
 */

/**
 * Secciones que el modelo no redacta: el stack y las restricciones los fijo el
 * usuario, y SUBTRACTIVE DESIGN contiene el texto de las tecnicas de diseno
 * que eligio (solo existe en el borrador si eligio alguna). Son instrucciones
 * para el generador de la pagina, no material creativo.
 */
export const VERBATIM_SECTIONS: readonly PromptSectionId[] = [
  'TECHNOLOGY',
  'SUBTRACTIVE_DESIGN',
  'NEGATIVE_CONSTRAINTS',
];

/**
 * Fragmentos del texto de cada tecnica (`design-techniques.ts`), ya
 * normalizados (minusculas, sin tildes), que solo aparecen si alguien
 * reproduce la tecnica. Sirven para detectar que el modelo colo una tecnica NO
 * elegida dentro de otra seccion. Son frases largas a proposito: una corta
 * ("maximo 6 secciones") podria salir de una redaccion legitima.
 *
 * Detecta copiar la redaccion de la tecnica, no parafrasearla. Es un
 * `Record` exhaustivo: al anadir una tecnica, TypeScript obliga a anadir aqui
 * sus fragmentos.
 */
const TECHNIQUE_FINGERPRINTS: Record<DesignTechniqueId, readonly string[]> = {
  'seed-strings': ['no es un adorno tematico', 'podria haberse generado con cualquier otra seed'],
  'ambitious-prompts': ['sesgos cognitivos que puedes aprovechar', 'que respuesta emocional exacta buscas'],
  'subagent-feedback': ['actua como tu propio critico', 'al menos 3 puntos de friccion'],
  'image-generation': ['data-ai-image="[prompt en ingles]"', 'escribe un marcador sin atributo src'],
  'video-generation': ['<!-- video:', 'generador de video (runway'],
  'subtractive-design': [
    'maximo 6 secciones en el cuerpo',
    'maximo 4 tarjetas por reticula',
    'un unico cta primario por pantalla',
    'maximo 3 campos en cualquier formulario',
  ],
  // Ademas del texto de la tecnica, la lista base (`BASE_NEGATIVE_CONSTRAINTS`): sin elegirla
  // no puede haber restricciones negativas, ni siquiera redactadas por el modelo.
  'negative-constraints-plus': [
    'tics que delatan contenido generado por ia',
    'piel perfecta',
    'sin degradados morados',
    'sin glassmorphism',
    'sin sombras difusas de gran radio',
  ],
  'human-writing': ['frases concretas con sujeto, verbo y consecuencia', 'longitud variable de frase'],
};

export interface ReconciledPrompt {
  sections: PromptSection[];
  /** Secciones que el modelo escribio y el borrador no traia: se descartaron. */
  dropped: PromptSectionId[];
}

/**
 * La respuesta del modelo se rechaza y el llamador cae al borrador. El mensaje
 * esta pensado para ensenarse al usuario (no lleva datos del proveedor), a
 * diferencia de un fallo de red o de cuota.
 */
export class PromptRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptRejectedError';
  }
}

/**
 * Secciones donde el modelo redacta hechos del proyecto (que es, para quien, que
 * promete): ahi no puede aparecer una cifra, un plazo o un nombre que el encargo
 * no trae. VISUAL DIRECTION y SEED STRING quedan fuera a proposito: estan llenas de
 * numeros legitimos (colores, rem, grados) y de nombres de fuentes.
 */
const CLAIM_SECTIONS: readonly PromptSectionId[] = [
  'CONTEXT',
  'OBJECTIVE',
  'TARGET_AUDIENCE',
  'BUSINESS_GOAL',
  'INFORMATION_ARCHITECTURE',
  'COPY_REQUIREMENTS',
];
/** Los nombres propios solo se vigilan donde no se esta proponiendo la estructura de la pagina. */
const NAME_SECTIONS: readonly PromptSectionId[] = ['CONTEXT', 'TARGET_AUDIENCE', 'BUSINESS_GOAL', 'COPY_REQUIREMENTS'];

/** Minusculas, sin tildes y con los espacios colapsados: para comparar texto. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Convierte la respuesta del modelo en las secciones definitivas. Lanza si el
 * modelo incumple algo que no se puede corregir sin inventar contenido (falta
 * una seccion que solo el podia redactar, o colo una tecnica no elegida): el
 * llamador cae entonces al borrador determinista.
 */
export function reconcileComposedSections(
  rawText: string,
  draftSections: readonly PromptSection[],
  techniqueIds: readonly DesignTechniqueId[],
): ReconciledPrompt {
  const composed = parseComposedSections(rawText);
  const draftById = new Map(draftSections.map((section) => [section.id, section]));
  const composedById = new Map<PromptSectionId, PromptSection>();
  for (const section of composed) if (!composedById.has(section.id)) composedById.set(section.id, section);

  const dropped = [...new Set(composed.filter((section) => !draftById.has(section.id)).map((section) => section.id))];

  // Las verbatim no cuentan como "omitidas": se restauran mas abajo.
  const missing = draftSections.filter(
    (section) => !VERBATIM_SECTIONS.includes(section.id) && !composedById.has(section.id),
  );
  if (missing.length > 0) {
    throw new PromptRejectedError(
      `El prompt compuesto por el LLM omitio secciones obligatorias: ${missing.map((s) => s.title).join(', ')}.`,
    );
  }

  const sections = SECTION_ORDER.flatMap((id) => {
    const fromDraft = draftById.get(id);
    if (!fromDraft) return [];
    if (VERBATIM_SECTIONS.includes(id)) return [fromDraft];
    const fromModel = composedById.get(id);
    return fromModel ? [fromModel] : [];
  });

  const leaked = findUnselectedTechniques(
    sections.filter((section) => !VERBATIM_SECTIONS.includes(section.id)),
    draftSections,
    techniqueIds,
  );
  if (leaked.length > 0) {
    throw new PromptRejectedError(
      `El prompt compuesto por el LLM incluyo tecnicas que no se eligieron: ${leaked.join(', ')}.`,
    );
  }

  const invented = findInventedClaims(sections, draftSections);
  if (invented.length > 0) {
    throw new PromptRejectedError(
      `El prompt compuesto por el LLM afirma datos que el encargo no aporta (${invented.slice(0, 8).join(', ')}${invented.length > 8 ? ', ...' : ''}).`,
    );
  }

  return { sections, dropped };
}

/* -------------------------------------------------------------------------
 * Datos inventados
 * ---------------------------------------------------------------------- */

const NUMBER_WORDS: Record<string, string> = {
  dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10',
  once: '11', doce: '12', trece: '13', catorce: '14', quince: '15', dieciseis: '16', diecisiete: '17',
  dieciocho: '18', diecinueve: '19', veinte: '20', treinta: '30', cuarenta: '40', cincuenta: '50',
  sesenta: '60', setenta: '70', ochenta: '80', noventa: '90', cien: '100', ciento: '100', mil: '1000',
};

/** Unidades de las que se inventan afirmaciones ("5 minutos", "500 clientes"). Forma normalizada -> raiz. */
const UNIT_FORMS: Record<string, readonly string[]> = {
  minuto: ['minuto', 'minutos', 'min'],
  hora: ['hora', 'horas'],
  dia: ['dia', 'dias'],
  semana: ['semana', 'semanas'],
  mes: ['mes', 'meses'],
  ano: ['ano', 'anos'],
  segundo: ['segundo', 'segundos'],
  cliente: ['cliente', 'clientes'],
  usuario: ['usuario', 'usuarios'],
  tienda: ['tienda', 'tiendas'],
  empresa: ['empresa', 'empresas'],
  pedido: ['pedido', 'pedidos'],
  pieza: ['pieza', 'piezas'],
  proyecto: ['proyecto', 'proyectos'],
  producto: ['producto', 'productos'],
  pais: ['pais', 'paises'],
  ciudad: ['ciudad', 'ciudades'],
  integracion: ['integracion', 'integraciones'],
  canal: ['canal', 'canales'],
  plantilla: ['plantilla', 'plantillas'],
  reporte: ['reporte', 'reportes'],
  marca: ['marca', 'marcas'],
  equipo: ['equipo', 'equipos'],
  persona: ['persona', 'personas'],
  descarga: ['descarga', 'descargas'],
  resena: ['resena', 'resenas'],
  estrella: ['estrella', 'estrellas'],
  transaccion: ['transaccion', 'transacciones'],
  envio: ['envio', 'envios'],
};
const UNIT_STEM = new Map(Object.entries(UNIT_FORMS).flatMap(([stem, forms]) => forms.map((form) => [form, stem] as const)));

const NUMBER = '\\d+(?:[.,]\\d+)*';
const QUANTITY = new RegExp(
  `\\b(?:(${NUMBER})\\s*|(${Object.keys(NUMBER_WORDS).join('|')})\\s+)(?:de\\s+)?(${[...UNIT_STEM.keys()]
    .sort((a, b) => b.length - a.length)
    .join('|')})\\b`,
  'g',
);

/** 3, "3,5" o "tres" -> solo digitos, para que "quince" y "15" sean la misma cifra. */
const digitsOf = (raw: string): string => NUMBER_WORDS[raw] ?? raw.replace(/\D/g, '');

/**
 * Afirmaciones cuantitativas de un texto: cantidades con unidad, porcentajes,
 * dinero, "24/7" y anos. Clave canonica (cifra|unidad) -> como aparece, para poder
 * decir cual es. No intenta entender frases: solo lo que se puede comparar sin
 * ambiguedad con lo que aporta el encargo.
 */
export function extractClaims(text: string): Map<string, string> {
  const t = normalize(text);
  const claims = new Map<string, string>();
  const add = (key: string, label: string) => {
    if (!claims.has(key)) claims.set(key, label.trim());
  };

  for (const m of t.matchAll(QUANTITY)) {
    const unit = UNIT_STEM.get(m[3] ?? '');
    const amount = digitsOf(m[1] ?? m[2] ?? '');
    if (unit && amount) add(`${amount}|${unit}`, m[0]);
  }
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|por ciento)/g)) add(`${digitsOf(m[1] ?? '')}|%`, m[0]);
  for (const m of t.matchAll(/(\d[\d.,]*)\s*(?:€|\$|eur\b|usd\b|euros?\b|dolares?\b)/g)) add(`${digitsOf(m[1] ?? '')}|moneda`, m[0]);
  for (const m of t.matchAll(/(?:€|\$|usd\s|eur\s)\s*(\d[\d.,]*)/g)) add(`${digitsOf(m[1] ?? '')}|moneda`, m[0]);
  if (/\b24\s*\/\s*7\b|\b24\s*h\b/.test(t)) add('24/7|*', '24/7');
  for (const m of t.matchAll(/\b((?:19|20)\d{2})\b/g)) add(`${m[1]}|ano`, m[0]);

  return claims;
}

/** Mayuscula inicial en mitad de frase (tras una palabra o una coma): marca, producto o integracion. */
const PROPER_NOUN = /(?<=[a-záéíóúñ,;] )[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}\b/g;
/** Palabras de interfaz que un modelo pone en mayuscula sin que sean un nombre propio. */
const NEUTRAL_CAPITALIZED = new Set(['hero', 'dashboard', 'footer', 'header', 'landing', 'banner', 'newsletter', 'checkout', 'onboarding', 'online', 'email', 'software', 'web']);

/**
 * Datos que el modelo afirma en las secciones que redacta y que NO estan en el
 * borrador: cantidades, plazos, porcentajes, dinero, anos y nombres propios (marcas,
 * integraciones). El borrador incluye el brief y el analisis DISCOVER: lo que el
 * usuario o ese analisis ya dicen no cuenta como inventado.
 *
 * Es una comprobacion literal: no detecta un dato inventado dicho con otras palabras
 * ("en un par de minutos") ni un nombre propio sin mayuscula.
 */
export function findInventedClaims(
  modelSections: readonly PromptSection[],
  draftSections: readonly PromptSection[],
): string[] {
  const draftText = draftSections.map((section) => section.body).join('\n');
  const known = extractClaims(draftText);
  const draftWords = new Set(normalize(draftText).split(/[^a-z0-9]+/).filter(Boolean));
  const invented = new Set<string>();

  for (const section of modelSections) {
    if (CLAIM_SECTIONS.includes(section.id)) {
      for (const [key, label] of extractClaims(section.body)) if (!known.has(key)) invented.add(label);
    }
    if (NAME_SECTIONS.includes(section.id)) {
      for (const match of section.body.matchAll(PROPER_NOUN)) {
        const word = normalize(match[0]);
        if (!draftWords.has(word) && !NEUTRAL_CAPITALIZED.has(word)) invented.add(match[0]);
      }
    }
  }
  return [...invented];
}

/**
 * Tecnicas NO elegidas cuyo texto aparece en las secciones que escribio el
 * modelo. Un fragmento que ya estaba en el borrador (p. ej. lo escribio el
 * usuario en su brief) no cuenta: no lo ha introducido el modelo.
 */
function findUnselectedTechniques(
  modelSections: readonly PromptSection[],
  draftSections: readonly PromptSection[],
  techniqueIds: readonly DesignTechniqueId[],
): DesignTechniqueId[] {
  const selected = new Set(techniqueIds);
  const written = normalize(modelSections.map((section) => section.body).join('\n'));
  const draft = normalize(draftSections.map((section) => section.body).join('\n'));

  return (Object.keys(TECHNIQUE_FINGERPRINTS) as DesignTechniqueId[]).filter(
    (id) =>
      !selected.has(id) &&
      TECHNIQUE_FINGERPRINTS[id].some((fragment) => written.includes(fragment) && !draft.includes(fragment)),
  );
}

/**
 * Mismo formato que produce `buildLandingPrompt`: bloques `## TITULO`.
 *
 * El emparejamiento tolera variaciones menores del titulo (medido con
 * qwen3:8b via Ollama: escribio "## COPY" en vez de "## COPY REQUIREMENTS",
 * "## RESPONSIVE DESIGN" en vez de "## RESPONSIVE REQUIREMENTS"). Los 17
 * titulos canonicos tienen todos una primera palabra distinta, asi que
 * emparejar por esa primera palabra cuando falla el match exacto es seguro y
 * evita descartar el borrador del LLM por una diferencia cosmetica.
 */
export function parseComposedSections(rawText: string): PromptSection[] {
  const titleToId = new Map<string, PromptSectionId>(
    SECTION_ORDER.map((id) => [SECTION_TITLES[id].toUpperCase(), id]),
  );
  const firstWordToId = new Map<string, PromptSectionId>(
    SECTION_ORDER.map((id) => [SECTION_TITLES[id].toUpperCase().split(/\s+/)[0] ?? '', id]),
  );

  const matchSectionId = (rawTitle: string): PromptSectionId | null => {
    const normalized = rawTitle.trim().toUpperCase();
    return titleToId.get(normalized) ?? firstWordToId.get(normalized.split(/\s+/)[0] ?? '') ?? null;
  };

  const sections: PromptSection[] = [];
  let currentId: PromptSectionId | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentId && buffer.length > 0) {
      const body = buffer.join('\n').trim();
      if (body.length > 0) sections.push({ id: currentId, title: SECTION_TITLES[currentId], body });
    }
    buffer = [];
  };

  for (const line of rawText.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      flush();
      currentId = matchSectionId(heading[1]);
    } else if (currentId) {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}
