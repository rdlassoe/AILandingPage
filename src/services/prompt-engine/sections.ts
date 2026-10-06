import type { PromptSectionId } from '@/types/domain';

/**
 * Titulos y orden canonicos de las 17 secciones, mas la instruccion de
 * sistema por defecto. Vive en su propio modulo, sin depender de nada mas de
 * `prompt-engine/`, porque tanto `index.ts` (el ensamblador determinista)
 * como `llm-prompt-composer.ts` (el que lo reescribe con un LLM) necesitan
 * exactamente los mismos titulos. Importarlos desde `index.ts` en los dos
 * sentidos crea un ciclo que Node y TypeScript tragan pero que webpack
 * rompe en produccion ("Cannot access '...' before initialization").
 */

export const SECTION_TITLES: Record<PromptSectionId, string> = {
  ROLE: 'ROLE',
  CONTEXT: 'CONTEXT',
  OBJECTIVE: 'OBJECTIVE',
  TARGET_AUDIENCE: 'TARGET AUDIENCE',
  BUSINESS_GOAL: 'BUSINESS GOAL',
  VISUAL_DIRECTION: 'VISUAL DIRECTION',
  SEED_STRING: 'SEED STRING',
  INFORMATION_ARCHITECTURE: 'INFORMATION ARCHITECTURE',
  COPY_REQUIREMENTS: 'COPY REQUIREMENTS',
  TECHNOLOGY: 'TECHNOLOGY',
  FUNCTIONAL_REQUIREMENTS: 'FUNCTIONAL REQUIREMENTS',
  RESPONSIVE_REQUIREMENTS: 'RESPONSIVE REQUIREMENTS',
  ACCESSIBILITY: 'ACCESSIBILITY',
  SUBTRACTIVE_DESIGN: 'SUBTRACTIVE DESIGN',
  NEGATIVE_CONSTRAINTS: 'NEGATIVE CONSTRAINTS',
  QUALITY_CRITERIA: 'QUALITY CRITERIA',
  OUTPUT_FORMAT: 'OUTPUT FORMAT',
};

export const SECTION_ORDER: PromptSectionId[] = [
  'ROLE',
  'CONTEXT',
  'OBJECTIVE',
  'TARGET_AUDIENCE',
  'BUSINESS_GOAL',
  'VISUAL_DIRECTION',
  'SEED_STRING',
  'INFORMATION_ARCHITECTURE',
  'COPY_REQUIREMENTS',
  'TECHNOLOGY',
  'FUNCTIONAL_REQUIREMENTS',
  'RESPONSIVE_REQUIREMENTS',
  'ACCESSIBILITY',
  'SUBTRACTIVE_DESIGN',
  'NEGATIVE_CONSTRAINTS',
  'QUALITY_CRITERIA',
  'OUTPUT_FORMAT',
];

const SYSTEM_RULES = [
  'Devuelves UNICAMENTE codigo. Nunca escribes introducciones, explicaciones ni despedidas.',
  'La primera linea de tu respuesta es exactamente "<!DOCTYPE html>".',
  'La ultima linea de tu respuesta es exactamente "</html>".',
  'No envuelves la respuesta en bloques de markdown.',
  'Todo el contenido textual es real y especifico del proyecto: nunca lorem ipsum.',
  'Cada interaccion que anuncias debe estar implementada y funcionar.',
];

const NEGATIVE_CONSTRAINTS_RULE = 'Cumples las restricciones negativas como requisitos duros, no como sugerencias.';

/**
 * Instruccion de sistema de la generacion. Solo habla de restricciones
 * negativas si el prompt las lleva (tecnica `negative-constraints-plus`): una
 * regla que remite a algo que no existe contradice al propio prompt.
 */
export function buildSystemInstruction(options: { negativeConstraints?: boolean } = {}): string {
  const rules = options.negativeConstraints ? [...SYSTEM_RULES, NEGATIVE_CONSTRAINTS_RULE] : SYSTEM_RULES;
  return [
    'Eres un equipo compuesto por un director de arte digital, un disenador de producto senior,',
    'un copywriter de conversion y un desarrollador front-end.',
    '',
    'Reglas invariables:',
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
  ].join('\n');
}

/** Instruccion de sistema neutra (sin restricciones negativas): respaldo de refinar y variar. */
export const DEFAULT_SYSTEM_INSTRUCTION = buildSystemInstruction();
