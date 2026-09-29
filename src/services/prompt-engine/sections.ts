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

/** Instruccion de sistema por defecto si no hay plantilla en base de datos. */
export const DEFAULT_SYSTEM_INSTRUCTION = [
  'Eres un equipo compuesto por un director de arte digital, un disenador de producto senior,',
  'un copywriter de conversion y un desarrollador front-end. Trabajas para clientes exigentes',
  'que rechazan resultados genericos.',
  '',
  'Reglas invariables:',
  '1. Devuelves UNICAMENTE codigo. Nunca escribes introducciones, explicaciones ni despedidas.',
  '2. La primera linea de tu respuesta es exactamente "<!DOCTYPE html>".',
  '3. La ultima linea de tu respuesta es exactamente "</html>".',
  '4. No envuelves la respuesta en bloques de markdown.',
  '5. Todo el contenido textual es real y especifico del proyecto: nunca lorem ipsum.',
  '6. Cada interaccion que anuncias debe estar implementada y funcionar.',
  '7. Cumples las restricciones negativas como requisitos duros, no como sugerencias.',
].join('\n');
