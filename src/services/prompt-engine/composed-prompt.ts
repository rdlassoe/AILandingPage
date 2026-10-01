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
  'negative-constraints-plus': ['tics que delatan contenido generado por ia', 'piel perfecta'],
  'human-writing': ['frases concretas con sujeto, verbo y consecuencia', 'longitud variable de frase'],
};

export interface ReconciledPrompt {
  sections: PromptSection[];
  /** Secciones que el modelo escribio y el borrador no traia: se descartaron. */
  dropped: PromptSectionId[];
}

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
    throw new Error(
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
    throw new Error(`El prompt compuesto por el LLM incluyo tecnicas que no se eligieron: ${leaked.join(', ')}.`);
  }

  return { sections, dropped };
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
