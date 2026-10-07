import type { PromptConflict, Technology } from '@/types/domain';

/**
 * Prompt Composer (composicion de tecnologias)
 *
 * Recibe el stack seleccionado, carga las instrucciones de cada tecnologia,
 * detecta conflictos, resuelve prioridades y produce un unico bloque
 * TECHNOLOGY coherente.
 */

export interface ComposedTechnology {
  block: string;
  conflicts: PromptConflict[];
  /** Tecnologias efectivamente aplicadas tras resolver conflictos. */
  effective: Technology[];
  /** true si el stack puede producir un documento autocontenido para la preview. */
  selfContained: boolean;
}

export function composeTechnologies(technologies: Technology[]): ComposedTechnology {
  const sorted = [...technologies].sort((a, b) => a.sortOrder - b.sortOrder);
  const { effective, conflicts } = resolveConflicts(sorted);

  if (effective.length === 0) {
    return {
      block: [
        '- Stack: HTML5, CSS3, JavaScript',
        '',
        'No se selecciono ninguna tecnologia. Entrega un unico documento HTML',
        'autocontenido con CSS embebido en <style> y JavaScript en <script>,',
        'sin dependencias externas.',
      ].join('\n'),
      conflicts,
      effective,
      selfContained: true,
    };
  }

  const stackLine = `- Stack: ${effective.map(formatName).join(', ')}`;

  const instructions = effective
    .map((tech) => [`### ${formatName(tech)}`, tech.promptInstructions.trim()].join('\n'))
    .join('\n\n');

  const constraints = dedupe(effective.flatMap((tech) => tech.constraints));
  const outputRequirements = dedupe(effective.flatMap((tech) => tech.outputRequirements));

  const selfContained = effective.every((tech) => tech.selfContainedPreview);

  const block = [
    stackLine,
    '',
    instructions,
    '',
    // Solo si alguna tecnologia las trae (las del catalogo ya no: ver `catalog.ts`; si las
    // declara una tecnologia creada por el usuario, se respetan). Sin ellas, sin titulo vacio.
    ...(constraints.length > 0 ? ['### Restricciones tecnicas', ...constraints.map((item) => `- ${item}`), ''] : []),
    '### Requisitos de salida del stack',
    ...outputRequirements.map((item) => `- ${item}`),
    ...(conflicts.length > 0
      ? [
          '',
          '### Conflictos resueltos',
          ...conflicts.map((conflict) => `- ${conflict.reason} Resolucion: ${conflict.resolution}`),
        ]
      : []),
    ...(selfContained
      ? []
      : [
          '',
          '### Vista previa',
          'Este stack no produce por si mismo un documento renderizable en un iframe.',
          'Ademas del codigo del framework, entrega SIEMPRE al final un documento HTML',
          'unico y autocontenido, equivalente visualmente, que empiece por <!DOCTYPE html>',
          'y termine en </html>. Ese documento es el que se usara para la vista previa.',
        ]),
  ].join('\n');

  return { block, conflicts, effective, selfContained };
}

/**
 * Detecta incompatibilidades declaradas y conserva la tecnologia de mayor
 * prioridad. Nunca elimina silenciosamente: el conflicto se devuelve para
 * mostrarlo al usuario.
 */
function resolveConflicts(technologies: Technology[]): {
  effective: Technology[];
  conflicts: PromptConflict[];
} {
  const conflicts: PromptConflict[] = [];
  const discarded = new Set<string>();

  for (const tech of technologies) {
    if (discarded.has(tech.id)) continue;

    for (const otherSlug of tech.conflictsWith) {
      const other = technologies.find((t) => t.slug === otherSlug || t.id === otherSlug);
      if (!other || discarded.has(other.id)) continue;

      const loser = tech.priority >= other.priority ? other : tech;
      const winner = loser.id === tech.id ? other : tech;
      discarded.add(loser.id);

      conflicts.push({
        technologies: [tech.name, other.name],
        reason: `${tech.name} y ${other.name} resuelven la misma capa y no deben combinarse.`,
        resolution: `Se aplica ${winner.name} y se ignora ${loser.name} en las instrucciones de estilo.`,
      });
    }
  }

  return {
    effective: technologies.filter((tech) => !discarded.has(tech.id)),
    conflicts,
  };
}

function formatName(tech: Technology): string {
  // "HTML5" + version "5" daba "HTML5 5": la version solo se anade si el nombre no la lleva ya.
  if (!tech.version || tech.name.endsWith(tech.version)) return tech.name;
  return `${tech.name} ${tech.version}`;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}
