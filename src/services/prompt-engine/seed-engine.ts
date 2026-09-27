import { detectSeedCategory } from '@/lib/llm/mock/brief-parser';
import { PRESET_SEEDS } from '@/lib/data/catalog';
import type { SeedDirectives, SeedString } from '@/types/domain';
import type { SeedResolution } from '@/types/services';

/**
 * Seed String Engine (SSoT)
 *
 * Una Seed String ancla el contexto semantico de la generacion para evitar
 * que todas las Landing Pages converjan hacia la misma estructura visual.
 *
 * Se trata como una estrategia de diversificacion creativa, NO como una
 * fuente de aleatoriedad criptografica: las cadenas generadas aqui solo
 * sirven para separar el espacio de salidas del modelo.
 */

const VOCABULARY = {
  movimiento: [
    'diseno suizo',
    'Bauhaus funcional',
    'brutalismo web',
    'modernismo escandinavo',
    'constructivismo',
    'minimalismo japones',
    'postmodernismo editorial',
  ],
  materia: [
    'hormigon visto',
    'papel prensa',
    'acero cepillado',
    'madera sin tratar',
    'vidrio industrial',
    'tinta sobre algodon',
    'plastico tecnico',
  ],
  disciplina: [
    'cartografia',
    'instrumentacion de laboratorio',
    'senaletica aeroportuaria',
    'fotografia documental',
    'diagramas de ingenieria',
    'encuadernacion editorial',
    'arquitectura de interiores',
  ],
  tension: [
    'orden frente a accidente',
    'densidad frente a vacio',
    'rigor frente a gesto',
    'serie frente a pieza unica',
    'norma frente a excepcion',
  ],
  luz: [
    'luz rasante de tarde',
    'luz difusa de norte',
    'iluminacion cenital de taller',
    'contraluz suave',
    'luz artificial fria',
  ],
} as const;

type VocabularyKey = keyof typeof VOCABULARY;

const AXES: VocabularyKey[] = ['movimiento', 'materia', 'disciplina', 'tension', 'luz'];

/**
 * Genera una Seed String interna para diversificar variantes.
 * No se muestra al usuario salvo que pida verla explicitamente.
 */
export function generateSeedString(entropy: number = Math.random()): string {
  let cursor = Math.abs(Math.floor(entropy * 1_000_003));
  const parts: string[] = [];

  for (const axis of AXES) {
    const options = VOCABULARY[axis];
    cursor = (cursor * 1103515245 + 12345) >>> 0;
    const index = cursor % options.length;
    parts.push(options[index] as string);
  }

  return parts.join(' + ');
}

const NEUTRAL_DIRECTIVES: SeedDirectives = {
  composition: 'Retícula clara y consistente; ningun elemento fuera de alineacion sin motivo.',
  typography: 'Una escala tipografica modular con dos familias como maximo.',
  color: 'Un color de acento y dos neutros; el acento se reserva para la accion principal.',
  hierarchy: 'Un unico elemento dominante por pantalla.',
  spacing: 'Ritmo vertical constante basado en un modulo fijo.',
  imagery: 'Imagenes con proposito informativo, nunca de relleno.',
  components: 'Componentes coherentes entre si: un solo radio, un solo grosor de borde.',
};

/** Deriva directrices concretas para una Seed escrita a mano. */
export function inferDirectives(value: string): SeedDirectives {
  const category = detectSeedCategory(value);
  const preset = PRESET_SEEDS.find((seed) => seed.category === category);
  return preset?.directives ?? NEUTRAL_DIRECTIVES;
}

/** Resuelve que Seed usar: la escrita a mano, la seleccionada o ninguna. */
export function resolveSeed(seed: SeedString | null, customValue?: string | null): SeedResolution {
  const custom = (customValue ?? '').trim();
  if (custom.length > 0) {
    return { value: custom, directives: inferDirectives(custom), source: 'custom' };
  }
  if (seed) {
    return { value: seed.value, directives: seed.directives, source: 'preset' };
  }
  return { value: '', directives: NEUTRAL_DIRECTIVES, source: 'none' };
}

/** Crea una resolucion a partir de una Seed generada internamente. */
export function generatedSeedResolution(): SeedResolution {
  const value = generateSeedString();
  return { value, directives: inferDirectives(value), source: 'generated' };
}

/** Bloque de prompt que traduce la Seed a decisiones de diseno. */
export function renderSeedBlock(resolution: SeedResolution): string {
  if (resolution.source === 'none') {
    return [
      '- Seed: sin direccion creativa explicita.',
      'Aplica un sistema visual coherente y evita la estetica generica de plantilla SaaS.',
    ].join('\n');
  }

  const d = resolution.directives;
  return [
    `- Seed: ${resolution.value}`,
    '',
    'Traduce esa direccion a decisiones concretas:',
    `- Composicion: ${d.composition}`,
    `- Tipografia: ${d.typography}`,
    `- Color: ${d.color}`,
    `- Jerarquia: ${d.hierarchy}`,
    `- Espaciado: ${d.spacing}`,
    `- Imagen: ${d.imagery}`,
    `- Componentes: ${d.components}`,
  ].join('\n');
}
