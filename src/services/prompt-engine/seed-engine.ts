import 'server-only';

import { randomBytes, randomUUID } from 'node:crypto';

import { runLLM } from '@/services/llm-orchestrator';
import type { ProviderId } from '@/types/llm';
import type { RandomSeedResult } from '@/types/services';

/**
 * Seed Engine — String Seed of Thought (SSoT)
 *
 * Implementa la tecnica de Misaki & Akiba (ICLR 2026, ver PDF en `docs/`): la
 * "Seed" de una Landing Page es UNICAMENTE un string aleatorio, generado de
 * nuevo en cada ejecucion. No hay catalogo que elegir ni traduccion previa a
 * directrices de diseno — este motor solo produce el string; quien lo recibe
 * (el Prompt Composer via LLM, o el hash deterministico del Mock Provider en
 * `brief-parser.ts`) es quien lo MANIPULA para derivar una direccion
 * creativa, exactamente como describe el paper.
 */

interface SSoTContext {
  ownerId: string;
  providerId?: ProviderId;
  model?: string;
}

/**
 * Instruccion minima del paper (ver Listing A.5, "Sequential Random String
 * Generation"): pedir solo el string, sin pedirle al modelo que lo derive en
 * nada todavia. La derivacion ocurre despues, en `composePromptViaLLM`, que
 * ya tiene el contexto completo del proyecto para hacerla con sentido.
 */
const RANDOM_STRING_SYSTEM = [
  'Eres un generador de datos aleatorios. Cuando se te pida un string',
  'aleatorio, primero genera uno unico y complejo, sin patron obvio ni',
  'estructura reconocible.',
  '',
  'Usa tu criterio para que parezca arbitrario e impredecible: mezcla',
  'mayusculas, minusculas, numeros y simbolos.',
  '',
  'Responde UNICAMENTE con el string, dentro de las etiquetas',
  '<random_string></random_string>. Nada de explicaciones antes o despues.',
].join('\n');

function extractTag(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(text);
  return match?.[1]?.trim() || null;
}

/**
 * Genera el string aleatorio de la Seed con un LLM real. Si el modelo no
 * respeta el formato, se usa su respuesta completa igualmente: cualquier
 * texto sirve como fuente de entropia, la etiqueta es solo para aislarlo con
 * limpieza cuando el modelo coopera.
 */
export async function generateRandomSeedString(
  ctx: SSoTContext,
): Promise<{ result: RandomSeedResult; latencyMs: number; inputTokens: number | null; outputTokens: number | null; providerId: ProviderId; model: string; cacheKey: string }> {
  const outcome = await runLLM({
    ownerId: ctx.ownerId,
    system: RANDOM_STRING_SYSTEM,
    prompt: [
      'Genera un string aleatorio complejo.',
      // El id de peticion no aporta nada al negocio: solo evita que una cache
      // por hash de (proveedor+modelo+prompt) devuelva la MISMA
      // "aleatoriedad" en dos ejecuciones distintas del mismo proyecto.
      `Id de peticion (uselo solo como parte de su string, no lo repita literal): ${randomUUID()}`,
    ].join('\n'),
    providerId: ctx.providerId,
    model: ctx.model,
    responseFormat: 'text',
  });

  const randomString = extractTag(outcome.text, 'random_string') || outcome.text.trim();

  return {
    result: { randomString, isMock: outcome.isMock },
    latencyMs: outcome.latencyMs,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    providerId: outcome.providerId,
    model: outcome.model,
    cacheKey: outcome.cacheKey,
  };
}

/**
 * Equivalente del modo demo: sin LLM, pero con aleatoriedad real (no
 * simulada) via `crypto.randomBytes`.
 */
export function generateRandomSeedForMock(): RandomSeedResult {
  return { randomString: randomBytes(24).toString('hex'), isMock: true };
}

/**
 * Bloque de prompt para la seccion SEED STRING. A diferencia de las
 * versiones anteriores de este motor, NO incluye directrices ya traducidas:
 * solo el string y la instruccion de manipularlo. Quien redacte el resto del
 * prompt (el Prompt Composer) es quien debe aplicar la tecnica.
 */
export function renderSeedBlock(randomString: string): string {
  return [
    `- String aleatorio: ${randomString}`,
    '',
    'Aplica la tecnica String Seed of Thought: manipula este string (por',
    'ejemplo sumando los codigos de sus caracteres y aplicando un modulo, o',
    'con un hash) para derivar de ese calculo una direccion creativa unica —',
    'no la elijas directamente, debe salir de procesar el string. Traduce esa',
    'direccion a decisiones concretas de composicion, retícula, escala',
    'tipografica, paleta, densidad de informacion, tratamiento de imagen y',
    'estilo de los componentes.',
  ].join('\n');
}
