import type { DesignTechnique, DesignTechniqueId } from '@/types/services';

/**
 * Tecnicas de diseno que el usuario puede activar o desactivar en el
 * Prompt Studio. Cada una inyecta un bloque concreto en el prompt final.
 */
export const DESIGN_TECHNIQUES: DesignTechnique[] = [
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
    id: 'human-copywriting',
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
  {
    id: 'visual-hierarchy',
    label: 'Jerarquia visual explicita',
    summary: 'Una sola idea dominante por pantalla.',
    defaultEnabled: true,
    instruction: [
      'Construye la jerarquia con tamano, peso y espacio antes que con color o cajas.',
      'En cada pantalla debe haber un unico elemento dominante; todo lo demas es subordinado.',
      'Usa una escala tipografica modular declarada en los tokens y no la rompas.',
      'El salto entre niveles debe ser evidente: si dos niveles se parecen, hay uno de mas.',
    ].join('\n'),
  },
  {
    id: 'progressive-disclosure',
    label: 'Revelacion progresiva',
    summary: 'Primero lo imprescindible; el detalle, bajo demanda.',
    defaultEnabled: false,
    instruction: [
      'Muestra primero lo que el usuario necesita para decidir si sigue leyendo.',
      'El detalle tecnico, las condiciones y las excepciones van en secciones posteriores',
      'o en elementos desplegables accesibles (con aria-expanded y control por teclado).',
      'Ningun contenido esencial puede quedar oculto tras una interaccion.',
    ].join('\n'),
  },
  {
    id: 'social-proof-discipline',
    label: 'Prueba social honesta',
    summary: 'Evidencia verificable en lugar de logos genericos.',
    defaultEnabled: false,
    instruction: [
      'Si incluyes prueba social, debe ser concreta y verificable: cifra, contexto y fuente.',
      'No inventes nombres de empresas reales, logotipos ni testimonios atribuidos a personas.',
      'Si no hay datos reales, usa un marcador explicito del tipo',
      '"[pendiente: 3 casos de clientes con metrica]" en lugar de rellenar con ficcion.',
    ].join('\n'),
  },
  {
    id: 'seed-anchoring',
    label: 'Anclaje de Seed String',
    summary: 'Traduce la Seed a decisiones de composicion, no a decoracion.',
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
    id: 'micro-copy',
    label: 'Micro-copy funcional',
    summary: 'Textos de apoyo que eliminan dudas justo antes de actuar.',
    defaultEnabled: false,
    instruction: [
      'Cada campo, boton y estado vacio lleva un texto de apoyo que responde',
      'a la duda inmediata del usuario: que pasa despues, cuanto cuesta, que datos se guardan.',
      'Los mensajes de error explican que ha fallado y como arreglarlo, nunca solo "error".',
    ].join('\n'),
  },
  {
    id: 'performance-budget',
    label: 'Presupuesto de rendimiento',
    summary: 'Pagina ligera, sin dependencias innecesarias.',
    defaultEnabled: false,
    instruction: [
      'Presupuesto: documento por debajo de 150 KB, cero librerias externas,',
      'cero fuentes remotas (usa pilas de fuentes del sistema), cero imagenes en base64 pesadas.',
      'Las animaciones se limitan a transform y opacity.',
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
