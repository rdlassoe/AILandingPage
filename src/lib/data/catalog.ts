import type { Technology } from '@/types/domain';

/**
 * Catalogo semilla de la plataforma.
 *
 * Es la fuente unica de la que beben:
 *  - el `LocalDataStore` la primera vez que arranca sin Supabase;
 *  - el script `supabase/seed.sql` (generado a partir de estos mismos datos);
 *  - la UI de Tecnologias.
 *
 * Las tecnologias NO estan cableadas en los componentes: se leen siempre del
 * DataStore, y el usuario puede anadir las suyas.
 */

const T = (
  slug: string,
  name: string,
  category: Technology['category'],
  version: string | null,
  description: string,
  promptInstructions: string,
  constraints: string[],
  outputRequirements: string[],
  options: {
    conflictsWith?: string[];
    priority?: number;
    selfContainedPreview?: boolean;
    sortOrder?: number;
  } = {},
): Omit<Technology, 'createdAt' | 'updatedAt'> => ({
  id: slug,
  slug,
  name,
  category,
  version,
  description,
  promptInstructions,
  constraints,
  outputRequirements,
  conflictsWith: options.conflictsWith ?? [],
  priority: options.priority ?? 10,
  selfContainedPreview: options.selfContainedPreview ?? true,
  isActive: true,
  sortOrder: options.sortOrder ?? 100,
  ownerId: null,
});

export const PRESET_TECHNOLOGIES: Omit<Technology, 'createdAt' | 'updatedAt'>[] = [
  T(
    'html5',
    'HTML5',
    'markup',
    '5',
    'Marcado semantico estandar. Base de cualquier salida renderizable en el preview.',
    [
      'Escribe HTML5 semantico y valido.',
      'Usa <header>, <nav>, <main>, <section>, <article>, <aside> y <footer> segun su significado real, no como contenedores decorativos.',
      'Cada seccion debe tener un encabezado (h2/h3) coherente con la jerarquia: un unico <h1> por documento.',
      'Declara <html lang="es">, <meta charset="utf-8"> y <meta name="viewport" content="width=device-width, initial-scale=1">.',
      'Incluye <title> y <meta name="description"> con contenido real, no marcadores de posicion.',
    ].join('\n'),
    [
      'No uses <div> cuando exista un elemento semantico adecuado.',
      'No dejes atributos alt vacios en imagenes informativas.',
      'No uses tablas para maquetar.',
    ],
    [
      'Un unico documento HTML completo que empiece por <!DOCTYPE html> y termine en </html>.',
      'Contenido textual real y especifico del proyecto.',
    ],
    { priority: 5, sortOrder: 10 },
  ),
  T(
    'css3',
    'CSS3',
    'styling',
    '3',
    'Estilos nativos con custom properties, grid y flexbox. Sin dependencias externas.',
    [
      'Escribe todo el CSS dentro de una unica etiqueta <style> en el <head>.',
      'Define un sistema de design tokens con custom properties en :root (color, espaciado, tipografia, radios, sombras).',
      'Usa CSS Grid para la maquetacion de pagina y Flexbox para la alineacion de componentes.',
      'Trabaja mobile-first: estilos base para movil y @media (min-width: ...) para pantallas mayores.',
      'Define estados :hover, :focus-visible y :active de forma explicita para todos los elementos interactivos.',
      'Respeta @media (prefers-reduced-motion: reduce) desactivando animaciones no esenciales.',
    ].join('\n'),
    [
      'No enlaces hojas de estilo externas ni CDNs.',
      'No uses !important salvo que sea imprescindible.',
      'No uses unidades fijas en px para tipografia de cuerpo: usa rem.',
    ],
    ['CSS embebido en <style>, organizado por bloques comentados (tokens, base, layout, componentes, responsive).'],
    { priority: 5, sortOrder: 20 },
  ),
  T(
    'javascript',
    'JavaScript',
    'language',
    'ES2022',
    'Interactividad ligera sin dependencias: menus, acordeones, validacion de formularios.',
    [
      'Escribe JavaScript vanilla moderno dentro de una unica etiqueta <script> antes de </body>.',
      'Toda interaccion debe ser funcional de verdad: menu movil que abre y cierra, FAQ que despliega, formulario que valida y muestra feedback.',
      'Actualiza los atributos ARIA relevantes (aria-expanded, aria-hidden) al cambiar de estado.',
      'Asegura que la pagina sigue siendo legible y utilizable si el script falla.',
    ].join('\n'),
    [
      'No uses librerias externas ni imports desde CDN.',
      'No inventes llamadas a APIs inexistentes: los formularios se manejan en cliente con feedback simulado y explicito.',
      'No uses alert() como mecanismo de feedback.',
    ],
    ['JavaScript embebido en <script>, sin dependencias, sin errores en consola.'],
    { priority: 5, sortOrder: 30 },
  ),
  T(
    'typescript',
    'TypeScript',
    'language',
    '5',
    'Tipado estatico para los ejemplos de codigo de componentes.',
    [
      'Cuando generes componentes, tipa explicitamente props, estados y retornos.',
      'Evita `any`: usa tipos concretos, uniones literales o genericos.',
      'Exporta las interfaces de props junto al componente.',
    ].join('\n'),
    ['No uses `any` ni `@ts-ignore`.', 'No declares tipos que no se utilicen.'],
    ['Codigo TypeScript compilable, con interfaces de props exportadas.'],
    { priority: 20, selfContainedPreview: false, sortOrder: 40 },
  ),
  T(
    'react',
    'React',
    'library',
    '19',
    'Componentes de interfaz mediante JSX y hooks.',
    [
      'Estructura la landing en componentes con una unica responsabilidad (Hero, Features, Pricing, FAQ, CTA, Footer).',
      'Usa hooks para el estado local; no introduzcas gestores de estado globales.',
      'Las listas deben tener `key` estable y derivarse de datos declarados como constantes al inicio del archivo.',
    ].join('\n'),
    ['No uses componentes de clase.', 'No introduzcas librerias de UI no solicitadas.'],
    ['Componentes React exportados y ensamblados en un componente raiz de pagina.'],
    { priority: 30, selfContainedPreview: false, sortOrder: 50 },
  ),
  T(
    'nextjs',
    'Next.js',
    'framework',
    '15',
    'App Router, Server Components y convenciones de archivos de Next.js.',
    [
      'Usa App Router: `app/page.tsx` como entrada y componentes en `components/`.',
      'Los componentes son Server Components por defecto; anade "use client" solo donde haya estado o eventos.',
      'Exporta `metadata` desde la pagina con title y description reales.',
      'Usa `next/image` para imagenes y `next/link` para navegacion interna.',
      'Ademas del codigo de Next.js, entrega SIEMPRE un documento HTML autocontenido equivalente para la vista previa.',
    ].join('\n'),
    [
      'No uses `getServerSideProps` ni el Pages Router.',
      'No inventes rutas de API que no se implementen.',
      'No uses `dangerouslySetInnerHTML`.',
    ],
    [
      'Arbol de archivos comentado con el contenido de cada archivo.',
      'Un documento HTML autocontenido equivalente para la vista previa.',
    ],
    { priority: 40, selfContainedPreview: false, sortOrder: 60 },
  ),
  T(
    'tailwindcss',
    'Tailwind CSS',
    'styling',
    '4',
    'Utilidades CSS. En modo preview se carga desde el runtime de navegador.',
    [
      'Aplica estilos exclusivamente con clases de utilidad de Tailwind.',
      'Define la paleta y la tipografia del proyecto con variables CSS en una capa @theme o en :root y referencialas desde las utilidades.',
      'Trabaja mobile-first usando los prefijos sm:, md:, lg: y xl:.',
      'Para la vista previa autocontenida, incluye el runtime de Tailwind mediante <script src="https://cdn.tailwindcss.com"></script> y la configuracion inline necesaria.',
      'Extrae patrones repetidos a componentes en lugar de duplicar cadenas de 20 utilidades.',
    ].join('\n'),
    [
      'No mezcles CSS suelto con Tailwind salvo para keyframes o tokens.',
      'No uses valores arbitrarios en exceso: prioriza la escala del sistema.',
    ],
    ['Marcado con clases de utilidad coherentes y una escala tipografica y de espaciado consistente.'],
    { conflictsWith: ['bootstrap'], priority: 35, sortOrder: 70 },
  ),
  T(
    'bootstrap',
    'Bootstrap',
    'styling',
    '5.3',
    'Sistema de rejilla y componentes predefinidos.',
    [
      'Usa la rejilla de Bootstrap (container, row, col-*) y sus utilidades de espaciado.',
      'Carga Bootstrap desde su CDN oficial en el <head> para que la vista previa funcione.',
      'Personaliza el aspecto con variables CSS propias para no entregar una pagina con el aspecto por defecto.',
    ].join('\n'),
    [
      'No entregues una pagina con la estetica por defecto de Bootstrap sin personalizar.',
      'No combines Bootstrap con Tailwind.',
    ],
    ['HTML con clases de Bootstrap y una capa de personalizacion visual propia.'],
    { conflictsWith: ['tailwindcss'], priority: 35, sortOrder: 80 },
  ),
  T(
    'vue',
    'Vue',
    'framework',
    '3',
    'Componentes SFC con Composition API.',
    [
      'Usa Single File Components con <script setup> y Composition API.',
      'Separa la landing en componentes por seccion.',
      'Para la vista previa, entrega ademas un documento HTML autocontenido equivalente.',
    ].join('\n'),
    ['No uses Options API.', 'No introduzcas Vuex ni Pinia para una landing estatica.'],
    ['Componentes .vue y un HTML autocontenido equivalente para la vista previa.'],
    { conflictsWith: ['react', 'nextjs'], priority: 40, selfContainedPreview: false, sortOrder: 90 },
  ),
  T(
    'astro',
    'Astro',
    'framework',
    '5',
    'Sitios estaticos orientados a contenido con hidratacion parcial.',
    [
      'Usa componentes .astro y envia cero JavaScript al cliente salvo que una interaccion lo exija.',
      'Aplica hidratacion parcial (client:visible) unicamente donde sea imprescindible.',
      'Para la vista previa, entrega ademas un documento HTML autocontenido equivalente.',
    ].join('\n'),
    ['No hidrates componentes estaticos.', 'No introduzcas frameworks de UI innecesarios.'],
    ['Componentes .astro y un HTML autocontenido equivalente para la vista previa.'],
    { conflictsWith: ['nextjs', 'vue'], priority: 40, selfContainedPreview: false, sortOrder: 100 },
  ),
  T(
    'lucide',
    'Lucide Icons',
    'icons',
    '0.544',
    'Iconografia de trazo consistente.',
    [
      'Usa iconos de Lucide unicamente cuando aporten significado funcional (estado, accion, categoria).',
      'En la vista previa autocontenida, inserta los iconos como SVG inline con stroke-width uniforme y `aria-hidden="true"` si son decorativos.',
      'Manten un unico tamano base de icono por contexto.',
    ].join('\n'),
    ['No uses iconos como relleno decorativo en cada tarjeta.', 'No mezcles varias familias de iconos.'],
    ['SVG inline coherentes con el resto del sistema visual.'],
    { priority: 15, sortOrder: 110 },
  ),
];

/** Restricciones negativas por defecto para cualquier proyecto nuevo. */
export const DEFAULT_NEGATIVE_CONSTRAINTS: string[] = [
  'Sin degradados morados ni azul-a-violeta.',
  'Sin el layout generico de SaaS: hero centrado + tres tarjetas + tabla de precios + FAQ.',
  'Sin glassmorphism ni fondos desenfocados.',
  'Sin tarjetas con bordes muy redondeados por todas partes.',
  'Sin sombras difusas de gran radio.',
  'Sin animaciones de entrada en cada seccion.',
  'Sin copy generico de IA: nada de "revoluciona", "desbloquea el poder", "lleva tu X al siguiente nivel".',
  'Sin fotografia de stock corporativa de personas sonriendo en oficinas.',
  'Sin emojis como sustituto de iconografia.',
  'Sin texto de relleno tipo lorem ipsum.',
];

/** Sugerencias de secciones para el asistente de proyecto. */
export const SECTION_SUGGESTIONS: string[] = [
  'Hero',
  'Propuesta de valor',
  'Como funciona',
  'Caracteristicas',
  'Beneficios',
  'Casos de uso',
  'Prueba social',
  'Datos y resultados',
  'Comparativa',
  'Precios',
  'Equipo',
  'FAQ',
  'CTA final',
  'Pie de pagina',
];

export const LANDING_CATEGORIES: string[] = [
  'SaaS',
  'Producto fisico',
  'Servicio profesional',
  'Evento',
  'Portfolio',
  'Captacion de leads',
  'App movil',
  'Formacion',
  'Ecommerce',
  'ONG',
];
