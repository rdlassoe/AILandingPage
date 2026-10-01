import type { DesignTechnique, DesignTechniqueId } from '@/types/services';

/**
 * Las 8 tecnicas de "Tratado Practico: 8 Tecnicas Avanzadas de Diseno de
 * Landing Pages con IA" (docs/8 Tecnicas Avanzadas...pdf), seleccionables y
 * combinables desde el Prompt Studio. Cada una inyecta un bloque concreto en
 * el prompt final.
 *
 * "Generacion de imagenes" SI se ejecuta: el LLM deja marcadores
 * `<img data-ai-image="...">` sin `src` y, tras validar la salida, el
 * servidor genera cada imagen con FLUX (Cloudflare Workers AI) y rellena el
 * `src` (`src/services/image-generator`). Sin Cloudflare configurado, los
 * marcadores se quedan como bloque neutro con su descripcion en un comentario.
 *
 * "Generacion de video" no: la app no integra ningun modelo de video, asi que
 * pide una DESCRIPCION detallada (como comentario junto al elemento), no el
 * archivo. Generarlo queda para quien reciba ese prompt como entrada a
 * Runway/Luma.
 *
 * "Restricciones Negativas" del PDF no es un toggle aqui: el prompt ya trae
 * una seccion NEGATIVE_CONSTRAINTS siempre presente y editable por proyecto.
 * Esta tecnica anade severidad extra sobre esa base, no la sustituye.
 */
export const DESIGN_TECHNIQUES: DesignTechnique[] = [
  {
    id: 'seed-strings',
    label: 'Cadenas Semilla (SSoT)',
    summary: 'Ancla la Seed derivada por la tecnica a decisiones concretas, no a decoracion.',
    defaultEnabled: true,
    instruction: [
      'La Seed String no es un adorno tematico: es la direccion creativa.',
      'Debe cambiar decisiones concretas de composicion, retícula, escala tipografica,',
      'paleta, densidad de informacion, tratamiento de imagen y estilo de los componentes.',
      'Si la pagina resultante podria haberse generado con cualquier otra Seed,',
      'no has aplicado la Seed.',
    ].join('\n'),
  },
  {
    id: 'ambitious-prompts',
    label: 'Prompts Ambiciosos',
    summary: 'Psicologia del usuario, sesgos cognitivos y friccion a eliminar, no solo estetica.',
    defaultEnabled: false,
    instruction: [
      'No te limites a describir el aspecto visual: define tambien la psicologia del',
      'usuario, el nivel de sofisticacion del mercado, los sesgos cognitivos que puedes',
      'aprovechar de forma honesta y la friccion concreta que vas a eliminar.',
      '',
      'Para cada seccion del scroll, ten decidida (aunque no la escribas explicita en el',
      'HTML): que respuesta emocional exacta buscas y que objecion resuelve.',
      'Pasa de descripciones esteticas a descripciones funcionales: micro-copy real,',
      'no adjetivos.',
    ].join('\n'),
  },
  {
    id: 'subagent-feedback',
    label: 'Bucles con subagentes',
    summary: 'Auto-audita el resultado bajo criterios de UX y persuasion antes de entregarlo.',
    defaultEnabled: false,
    instruction: [
      'Antes de dar tu respuesta por definitiva, actua como tu propio critico:',
      'revisa el diseno que ibas a entregar bajo criterios de UX, accesibilidad y',
      'persuasion, identifica al menos 3 puntos de friccion donde un usuario podria',
      'abandonar, y corrigelos en la version que realmente entregas.',
      'No expliques esta auto-revision en la respuesta: aplica sus conclusiones',
      'directamente al HTML final.',
    ].join('\n'),
  },
  {
    id: 'image-generation',
    label: 'Generacion de imagenes',
    summary: 'Genera imagenes reales con FLUX (Cloudflare) y las inserta en la pagina.',
    defaultEnabled: false,
    instruction: [
      'La pagina lleva imagenes REALES generadas con IA: el sistema las crea despues de',
      'recibir tu HTML. No uses fotografia de stock ni URLs de relleno. Para cada imagen',
      'relevante (maximo 4: el hero y, como mucho, tres mas) escribe un marcador SIN',
      'atributo src, con este formato:',
      '<img data-ai-image="[prompt en ingles]" alt="[descripcion en espanol]" width="1024" height="1024" loading="lazy" class="...">',
      '',
      '- data-ai-image: prompt en INGLES, de una a tres frases y 300 caracteres como maximo:',
      '  sujeto, composicion, iluminacion, paleta y estilo, coherentes con la direccion',
      '  visual del proyecto. Sin texto, letras, logotipos ni marcas de agua dentro de la',
      '  imagen, y sin rostros en primer plano.',
      '- alt: descripcion util de la imagen, en el idioma de la pagina.',
      '- Las imagenes salen CUADRADAS: ponlas en un contenedor con aspect-ratio y usa',
      '  object-fit: cover para que encajen en cualquier proporcion.',
      '- No escribas src ni inventes URLs: el sistema lo rellena. Mientras la imagen no',
      '  cargue, el contenedor debe verse bien (color de fondo coherente con la paleta).',
    ].join('\n'),
  },
  {
    id: 'video-generation',
    label: 'Generacion de video',
    summary: 'Describe un concepto de video (p.ej. fondo del hero) como prompt, no lo genera.',
    defaultEnabled: false,
    instruction: [
      'Si el hero o alguna seccion se beneficia de un fondo animado, no lo generes:',
      'deja un comentario HTML con la descripcion del video (encuadre, movimiento de',
      'camara, duracion aproximada, estilo, sin texto ni personas salvo que se pida),',
      'lista para pegar en un generador de video (Runway, Luma...). Formato:',
      '<!-- VIDEO: [descripcion detallada para el generador] -->',
      'La version que se ve en el navegador debe funcionar igual de bien sin el video',
      '(imagen o color de fondo equivalente), porque el video no se genera de verdad.',
    ].join('\n'),
  },
  {
    id: 'subtractive-design',
    label: 'Diseno sustractivo',
    summary: 'Audita cada elemento y elimina lo que no aporta.',
    defaultEnabled: true,
    instruction: [
      'Antes de dar la pagina por terminada, audita cada elemento y responde:',
      '¿aporta comprension, navegacion, conversion, confianza o jerarquia?',
      'Si la respuesta es no a las cinco, eliminalo.',
      '',
      'Aplica estos limites como techo, no como objetivo:',
      '- maximo 6 secciones en el cuerpo de la pagina;',
      '- maximo 4 tarjetas por retícula;',
      '- un unico CTA primario por pantalla;',
      '- maximo 3 campos en cualquier formulario;',
      '- ningun icono decorativo que no comunique estado, accion o categoria.',
      '',
      'Prefiere una pagina corta que se lea entera a una larga que se abandone.',
    ].join('\n'),
  },
  {
    id: 'negative-constraints-plus',
    label: 'Restricciones negativas reforzadas',
    summary: 'Severidad extra sobre las restricciones ya acordadas: nada de "huella de IA".',
    defaultEnabled: true,
    instruction: [
      'Ademas de las restricciones negativas ya listadas para este proyecto, evita',
      'especificamente los "tics" que delatan contenido generado por IA:',
      '- palabras como "delve", "comprehensive", "unlock", "revolucionario", "ecosistema";',
      '- imagenes con piel perfecta, mirando a camara o con iluminacion de estudio',
      'excesivamente limpia;',
      '- fondos de oficina genericos y sonrisas irreales;',
      '- cualquier afirmacion que no se pueda verificar con lo que hay en la propia pagina.',
      '',
      'Estas restricciones son requisitos duros, igual que las del proyecto: incumplir',
      'una invalida la entrega.',
    ].join('\n'),
  },
  {
    id: 'human-writing',
    label: 'Redaccion humana',
    summary: 'Copy concreto, sin cliches corporativos ni lenguaje de IA.',
    defaultEnabled: true,
    instruction: [
      'Escribe como una persona que conoce el producto y respeta al lector.',
      '',
      'Obligatorio:',
      '- frases concretas con sujeto, verbo y consecuencia;',
      '- cifras, plazos y nombres reales en lugar de adjetivos;',
      '- micro-copy contextual junto a cada accion (que pasa al pulsar, que no pasa);',
      '- vocabulario del publico objetivo, no del departamento de marketing;',
      '- longitud variable de frase para que el texto tenga ritmo.',
      '',
      'Prohibido: "revoluciona", "desbloquea el poder de", "lleva tu X al siguiente nivel",',
      '"solucion definitiva", "sin esfuerzo", "transforma tu negocio", "potencia tu equipo",',
      'y cualquier superlativo que no se pueda demostrar en la propia pagina.',
    ].join('\n'),
  },
];

export const DEFAULT_TECHNIQUE_IDS: DesignTechniqueId[] = DESIGN_TECHNIQUES.filter(
  (technique) => technique.defaultEnabled,
).map((technique) => technique.id);

export function getTechniques(ids: DesignTechniqueId[]): DesignTechnique[] {
  const wanted = new Set(ids);
  return DESIGN_TECHNIQUES.filter((technique) => wanted.has(technique.id));
}
