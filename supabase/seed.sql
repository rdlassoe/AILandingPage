-- ===========================================================================
-- AI LANDING STUDIO - Datos iniciales
--
-- ARCHIVO GENERADO. No editar a mano.
-- Se regenera con:  npm run seed:sql
-- Fuente: src/lib/data/catalog.ts y src/lib/data/prompt-templates.ts
--
-- Es idempotente: puede ejecutarse varias veces sobre la misma base.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Proveedores y modelos (catalogo informativo; la disponibilidad real la
-- decide el servidor segun las variables de entorno)
-- ---------------------------------------------------------------------------

insert into llm_providers (id, label, docs_url, env_key, is_enabled) values
  ('mock',   'Modo demo (sin IA)', '',                                        null,             true),
  ('gemini', 'Google Gemini',      'https://aistudio.google.com/apikey',      'GEMINI_API_KEY', true),
  ('groq',   'Groq',               'https://console.groq.com/keys',           'GROQ_API_KEY',   true),
  ('ollama', 'Ollama (local)',     'https://ollama.com/download',             null,             true)
on conflict (id) do update set
  label = excluded.label,
  docs_url = excluded.docs_url,
  env_key = excluded.env_key;

insert into llm_models (id, provider_id, label, context_window, max_output_tokens, good_for_long_output, description) values
  ('mock-studio-v1', 'mock', 'Demo determinista', 1000000, 100000, true, 'Plantillas reales de la aplicacion: genera HTML autocontenido y auditorias basadas en analisis estatico.'),
  ('gemini-flash-latest', 'gemini', 'Gemini Flash (ultima estable)', 1048576, 65536, true, 'Alias que sigue al Flash estable mas reciente. No hay que mantenerlo a mano.'),
  ('gemini-3.8-flash', 'gemini', 'Gemini 3.8 Flash', 1048576, 65536, true, 'Generacion mas reciente de la familia Flash.'),
  ('gemini-3.7-flash', 'gemini', 'Gemini 3.7 Flash', 1048576, 65536, true, 'Version fijada, util si quieres resultados reproducibles.'),
  ('gemini-3.6-flash', 'gemini', 'Gemini 3.6 Flash', 1048576, 65536, true, 'Version fijada de la familia Flash.'),
  ('gemini-3.5-flash', 'gemini', 'Gemini 3.5 Flash', 1048576, 65536, true, 'Algo mas antiguo y por eso menos saturado. Buena alternativa cuando los nuevos dan 503.'),
  ('gemini-3.5-flash-lite', 'gemini', 'Gemini 3.5 Flash Lite', 1048576, 65536, true, 'Mas barato y rapido; consume menos cuota. Bien para criticas y para DISCOVER.'),
  ('gemini-3.1-flash-lite', 'gemini', 'Gemini 3.1 Flash Lite', 1048576, 65536, true, 'Opcion economica de la generacion anterior.'),
  ('gemini-pro-latest', 'gemini', 'Gemini Pro (ultima estable)', 1048576, 65536, true, 'Mayor calidad de razonamiento y de diseno; mas lento y con mucha menos cuota gratuita.'),
  ('openai/gpt-oss-120b', 'groq', 'GPT-OSS 120B', 131072, 65536, true, 'El mas capaz de Groq. Opcion recomendada para generar landings completas.'),
  ('openai/gpt-oss-20b', 'groq', 'GPT-OSS 20B', 131072, 65536, true, 'Mismo limite de salida y mas rapido; menor calidad de diseno.'),
  ('qwen/qwen3.8-27b', 'groq', 'Qwen 3.8 27B', 131042, 16384, false, 'Muy rapido. Su limite de salida de 16K va justo para una landing larga.'),
  ('qwen3:8b', 'ollama', 'Qwen3 8B', 40960, 40960, true, 'Buen equilibrio entre calidad y velocidad en CPU/GPU domestica. Recomendado por defecto.'),
  ('qwen3:14b', 'ollama', 'Qwen3 14B', 40960, 40960, true, 'Mas capaz que la version 8B; mas lento y exige mas memoria.'),
  ('llama3.1', 'ollama', 'Llama 3.1 8B', 128000, 32768, true, 'Modelo generalista de Meta. Descargalo con `ollama pull llama3.1`.'),
  ('mistral', 'ollama', 'Mistral 7B', 32768, 16384, false, 'Ligero y rapido; util cuando el equipo tiene poca VRAM.'),
  ('deepseek-r1', 'ollama', 'DeepSeek R1', 64000, 32768, true, 'Modelo con razonamiento explicito. Igual que en Gemini, ese razonamiento consume presupuesto de salida.')
on conflict (id) do update set
  label = excluded.label,
  context_window = excluded.context_window,
  max_output_tokens = excluded.max_output_tokens,
  good_for_long_output = excluded.good_for_long_output,
  description = excluded.description;

-- Retira del catalogo los modelos que ya no existen en el codigo.
delete from llm_models where id not in ('mock-studio-v1', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-pro-latest', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'qwen3:8b', 'qwen3:14b', 'llama3.1', 'mistral', 'deepseek-r1');

-- ---------------------------------------------------------------------------
-- Categorias de Landing Page
-- ---------------------------------------------------------------------------

insert into landing_categories (slug, label) values
  ('saas', 'SaaS'),
  ('producto-fisico', 'Producto fisico'),
  ('servicio-profesional', 'Servicio profesional'),
  ('evento', 'Evento'),
  ('portfolio', 'Portfolio'),
  ('captacion-de-leads', 'Captacion de leads'),
  ('app-movil', 'App movil'),
  ('formacion', 'Formacion'),
  ('ecommerce', 'Ecommerce'),
  ('ong', 'ONG')
on conflict (slug) do update set label = excluded.label;

-- ---------------------------------------------------------------------------
-- Tecnologias (11)
-- owner_id null = catalogo comun, de solo lectura para los usuarios
-- ---------------------------------------------------------------------------

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'html5', 'html5', 'HTML5', 'Marcado semantico estandar. Base de cualquier salida renderizable en el preview.',
  'markup'::technology_category, '5',
  'Escribe HTML5 semantico y valido.
Usa <header>, <nav>, <main>, <section>, <article>, <aside> y <footer> segun su significado real, no como contenedores decorativos.
Cada seccion debe tener un encabezado (h2/h3) coherente con la jerarquia: un unico <h1> por documento.
Declara <html lang="es">, <meta charset="utf-8"> y <meta name="viewport" content="width=device-width, initial-scale=1">.
Incluye <title> y <meta name="description"> con contenido real, no marcadores de posicion.',
  array[]::text[], array['Un unico documento HTML completo que empiece por <!DOCTYPE html> y termine en </html>.', 'Contenido textual real y especifico del proyecto.']::text[], array[]::text[],
  5, true, true, 10, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'css3', 'css3', 'CSS3', 'Estilos nativos con custom properties, grid y flexbox. Sin dependencias externas.',
  'styling'::technology_category, '3',
  'Escribe todo el CSS dentro de una unica etiqueta <style> en el <head>.
Define un sistema de design tokens con custom properties en :root (color, espaciado, tipografia, radios, sombras).
Usa CSS Grid para la maquetacion de pagina y Flexbox para la alineacion de componentes.
Trabaja mobile-first: estilos base para movil y @media (min-width: ...) para pantallas mayores.
Define estados :hover, :focus-visible y :active de forma explicita para todos los elementos interactivos.
Respeta @media (prefers-reduced-motion: reduce) desactivando animaciones no esenciales.',
  array[]::text[], array['CSS embebido en <style>, organizado por bloques comentados (tokens, base, layout, componentes, responsive).']::text[], array[]::text[],
  5, true, true, 20, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'javascript', 'javascript', 'JavaScript', 'Interactividad ligera sin dependencias: menus, acordeones, validacion de formularios.',
  'language'::technology_category, 'ES2022',
  'Escribe JavaScript vanilla moderno dentro de una unica etiqueta <script> antes de </body>.
Toda interaccion debe ser funcional de verdad: menu movil que abre y cierra, FAQ que despliega, formulario que valida y muestra feedback.
Actualiza los atributos ARIA relevantes (aria-expanded, aria-hidden) al cambiar de estado.
Asegura que la pagina sigue siendo legible y utilizable si el script falla.',
  array[]::text[], array['JavaScript embebido en <script>, sin dependencias, sin errores en consola.']::text[], array[]::text[],
  5, true, true, 30, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'typescript', 'typescript', 'TypeScript', 'Tipado estatico para los ejemplos de codigo de componentes.',
  'language'::technology_category, '5',
  'Cuando generes componentes, tipa explicitamente props, estados y retornos.
Evita `any`: usa tipos concretos, uniones literales o genericos.
Exporta las interfaces de props junto al componente.',
  array[]::text[], array['Codigo TypeScript compilable, con interfaces de props exportadas.']::text[], array[]::text[],
  20, false, true, 40, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'react', 'react', 'React', 'Componentes de interfaz mediante JSX y hooks.',
  'library'::technology_category, '19',
  'Estructura la landing en componentes con una unica responsabilidad (Hero, Features, Pricing, FAQ, CTA, Footer).
Usa hooks para el estado local; no introduzcas gestores de estado globales.
Las listas deben tener `key` estable y derivarse de datos declarados como constantes al inicio del archivo.',
  array[]::text[], array['Componentes React exportados y ensamblados en un componente raiz de pagina.']::text[], array[]::text[],
  30, false, true, 50, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'nextjs', 'nextjs', 'Next.js', 'App Router, Server Components y convenciones de archivos de Next.js.',
  'framework'::technology_category, '15',
  'Usa App Router: `app/page.tsx` como entrada y componentes en `components/`.
Los componentes son Server Components por defecto; anade "use client" solo donde haya estado o eventos.
Exporta `metadata` desde la pagina con title y description reales.
Usa `next/image` para imagenes y `next/link` para navegacion interna.
Ademas del codigo de Next.js, entrega SIEMPRE un documento HTML autocontenido equivalente para la vista previa.',
  array[]::text[], array['Arbol de archivos comentado con el contenido de cada archivo.', 'Un documento HTML autocontenido equivalente para la vista previa.']::text[], array[]::text[],
  40, false, true, 60, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'tailwindcss', 'tailwindcss', 'Tailwind CSS', 'Utilidades CSS. En modo preview se carga desde el runtime de navegador.',
  'styling'::technology_category, '4',
  'Aplica estilos exclusivamente con clases de utilidad de Tailwind.
Define la paleta y la tipografia del proyecto con variables CSS en una capa @theme o en :root y referencialas desde las utilidades.
Trabaja mobile-first usando los prefijos sm:, md:, lg: y xl:.
Para la vista previa autocontenida, incluye el runtime de Tailwind mediante <script src="https://cdn.tailwindcss.com"></script> y la configuracion inline necesaria.
Extrae patrones repetidos a componentes en lugar de duplicar cadenas de 20 utilidades.',
  array[]::text[], array['Marcado con clases de utilidad coherentes y una escala tipografica y de espaciado consistente.']::text[], array['bootstrap']::text[],
  35, true, true, 70, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'bootstrap', 'bootstrap', 'Bootstrap', 'Sistema de rejilla y componentes predefinidos.',
  'styling'::technology_category, '5.3',
  'Usa la rejilla de Bootstrap (container, row, col-*) y sus utilidades de espaciado.
Carga Bootstrap desde su CDN oficial en el <head> para que la vista previa funcione.
Personaliza el aspecto con variables CSS propias para no entregar una pagina con el aspecto por defecto.',
  array[]::text[], array['HTML con clases de Bootstrap y una capa de personalizacion visual propia.']::text[], array['tailwindcss']::text[],
  35, true, true, 80, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'vue', 'vue', 'Vue', 'Componentes SFC con Composition API.',
  'framework'::technology_category, '3',
  'Usa Single File Components con <script setup> y Composition API.
Separa la landing en componentes por seccion.
Para la vista previa, entrega ademas un documento HTML autocontenido equivalente.',
  array[]::text[], array['Componentes .vue y un HTML autocontenido equivalente para la vista previa.']::text[], array['react', 'nextjs']::text[],
  40, false, true, 90, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'astro', 'astro', 'Astro', 'Sitios estaticos orientados a contenido con hidratacion parcial.',
  'framework'::technology_category, '5',
  'Usa componentes .astro y envia cero JavaScript al cliente salvo que una interaccion lo exija.
Aplica hidratacion parcial (client:visible) unicamente donde sea imprescindible.
Para la vista previa, entrega ademas un documento HTML autocontenido equivalente.',
  array[]::text[], array['Componentes .astro y un HTML autocontenido equivalente para la vista previa.']::text[], array['nextjs', 'vue']::text[],
  40, false, true, 100, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

insert into technologies (
  id, slug, name, description, category, version, prompt_instructions,
  constraints, output_requirements, conflicts_with, priority,
  self_contained_preview, is_active, sort_order, owner_id
) values (
  'lucide', 'lucide', 'Lucide Icons', 'Iconografia de trazo consistente.',
  'icons'::technology_category, '0.544',
  'Usa iconos de Lucide unicamente cuando aporten significado funcional (estado, accion, categoria).
En la vista previa autocontenida, inserta los iconos como SVG inline con stroke-width uniforme y `aria-hidden="true"` si son decorativos.
Manten un unico tamano base de icono por contexto.',
  array[]::text[], array['SVG inline coherentes con el resto del sistema visual.']::text[], array[]::text[],
  15, true, true, 110, null
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  version = excluded.version,
  prompt_instructions = excluded.prompt_instructions,
  constraints = excluded.constraints,
  output_requirements = excluded.output_requirements,
  conflicts_with = excluded.conflicts_with,
  priority = excluded.priority,
  self_contained_preview = excluded.self_contained_preview,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Plantillas de prompt (9)
-- ---------------------------------------------------------------------------

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'landing-generator.system', 'landing-generator.system', 'Sistema: generador de Landing Pages',
  'landing-generator'::prompt_template_kind,
  'Instruccion de sistema que fija el rol y el formato de salida del generador. La regla de restricciones negativas la anade el codigo (buildSystemInstruction) solo con esa tecnica elegida.',
  'Eres un equipo compuesto por un director de arte digital, un disenador de producto senior,
un copywriter de conversion y un desarrollador front-end.

Reglas invariables:
1. Devuelves UNICAMENTE codigo. Nunca escribes introducciones, explicaciones ni despedidas.
2. La primera linea de tu respuesta es exactamente "<!DOCTYPE html>".
3. La ultima linea de tu respuesta es exactamente "</html>".
4. No envuelves la respuesta en bloques de markdown con acentos graves.
5. Todo el contenido textual es real, concreto y especifico del proyecto: nunca lorem ipsum
   ni marcadores de posicion.
6. Cada interaccion que anuncias debe estar implementada y funcionar.',
  array[]::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'discover.system', 'discover.system', 'Sistema: analisis DISCOVER',
  'discover'::prompt_template_kind,
  'Fase de descubrimiento: analiza nicho, publico y direcciones visuales.',
  'Eres un estratega de producto digital. Analizas el encargo antes de disenar nada.
Devuelves UNICAMENTE un objeto JSON valido, sin markdown ni texto adicional.
Tu analisis es concreto, pero solo con lo que el encargo dice o permite deducir: nada de generalidades aplicables a cualquier negocio.
No inventes datos que el encargo no aporta: cifras, plazos, precios, clientes, integraciones, canales de soporte, garantias ni funciones.
Si el encargo no da base para un campo de lista, devuelvelo vacio ([]) en lugar de rellenarlo.',
  array[]::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'discover.user', 'discover.user', 'Usuario: analisis DISCOVER',
  'discover'::prompt_template_kind,
  'Peticion de analisis estrategico sobre el brief del proyecto.',
  'Analiza este encargo de Landing Page:

{{brief}}

Devuelve este JSON exacto:
{
  "niche": "nicho concreto en una frase",
  "audienceInsight": "que le preocupa realmente a este publico, en 2-3 frases",
  "valueProposition": "propuesta de valor en una frase, sin adjetivos vacios y usando solo lo que dice el encargo",
  "context": "contexto de mercado y momento de compra",
  "differentiators": ["solo diferenciadores que el encargo mencione o permita deducir (producto, caracteristicas, beneficios); [] si no hay ninguno"],
  "visualDirections": ["3 direcciones visuales posibles, cada una en una frase"],
  "marketSophistication": 3,
  "frictions": ["3-5 objeciones probables del publico (son hipotesis sobre el publico, no datos del producto)"]
}

marketSophistication va de 1 (mercado virgen) a 5 (mercado saturado de publicidad).',
  array['brief']::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'critic.system', 'critic.system', 'Sistema: Critic Engine',
  'ux-critic'::prompt_template_kind,
  'Agente critico que audita la landing generada antes del refinamiento.',
  'Eres un auditor independiente de producto digital. No disenaste esta pagina y no tienes
ningun interes en defenderla. Auditas UX, accesibilidad (WCAG 2.1 AA), jerarquia visual,
comportamiento responsive, claridad del copy, estrategia de CTA, calidad del codigo y
presencia de patrones genericos de IA.

Eres exigente pero util: cada problema que senalas incluye una accion concreta.
No senalas problemas inventados ni repites el mismo problema con distintas palabras.
Devuelves UNICAMENTE un objeto JSON valido, sin markdown ni texto adicional.',
  array[]::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'critic.user', 'critic.user', 'Usuario: peticion de critica',
  'ux-critic'::prompt_template_kind,
  'Envia la landing y los requisitos para obtener issues, sugerencias y prompt de refinamiento.',
  'REQUISITOS DEL PROYECTO
{{requirements}}

RESTRICCIONES QUE DEBIAN CUMPLIRSE
{{constraints}}

CODIGO A AUDITAR
{{html}}

Devuelve este JSON exacto:
{
  "issues": [
    {
      "dimension": "ux|accessibility|hierarchy|responsive|clarity|visual-consistency|cta|content|code|subtractive|generic-patterns",
      "severity": "critical|high|medium|low",
      "title": "titulo corto",
      "description": "que falla y por que importa",
      "location": "selector, seccion o fragmento afectado"
    }
  ],
  "suggestions": [
    {
      "dimension": "misma lista que arriba",
      "title": "titulo corto",
      "action": "cambio concreto y accionable",
      "impact": "alto|medio|bajo"
    }
  ],
  "scores": { "overall": 0, "ux": 0, "accessibility": 0, "content": 0, "code": 0, "design": 0 },
  "refinementPrompt": "instrucciones listas para regenerar la pagina corrigiendo lo anterior"
}

Las puntuaciones van de 0 a 100. Devuelve entre 3 y 12 issues.',
  array['requirements', 'constraints', 'html']::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'refinement.user', 'refinement.user', 'Usuario: refinamiento',
  'refinement'::prompt_template_kind,
  'Regenera la landing aplicando unicamente los cambios aceptados.',
  'Vas a corregir una Landing Page existente.

ENCARGO ORIGINAL
{{originalPrompt}}

VERSION ACTUAL
{{html}}

CAMBIOS QUE DEBES APLICAR
{{acceptedChanges}}

INSTRUCCIONES ADICIONALES DEL USUARIO
{{extraInstructions}}

REGLAS DEL REFINAMIENTO
- Aplica exactamente los cambios listados. No rediseñes lo que no se menciona.
- Conserva el contenido, el tono y la identidad visual que ya funcionaban.
- No introduzcas dependencias ni secciones nuevas que nadie ha pedido.
- Devuelve el documento HTML completo y autocontenido, no un fragmento ni un diff.
- Primera linea: <!DOCTYPE html>. Ultima linea: </html>. Sin markdown.',
  array['acceptedChanges', 'extraInstructions', 'originalPrompt', 'html']::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'variation.user', 'variation.user', 'Usuario: generacion de variante',
  'variation'::prompt_template_kind,
  'Produce una variante de la landing segun una estrategia de diversificacion.',
  'Vas a producir una VARIANTE de una Landing Page existente.

ENCARGO ORIGINAL
{{originalPrompt}}

VERSION ACTUAL
{{html}}

ESTRATEGIA DE VARIACION: {{strategy}}
{{strategyInstruction}}

DIRECCION CREATIVA PARA ESTA VARIANTE
{{seed}}

NOTAS DEL USUARIO
{{notes}}

REGLAS
- La variante debe ser reconociblemente distinta, no un ajuste cosmetico.
- Manten la calidad y la accesibilidad del encargo original.
- Devuelve el documento HTML completo y autocontenido.
- Primera linea: <!DOCTYPE html>. Ultima linea: </html>. Sin markdown.',
  array['strategy', 'strategyInstruction', 'seed', 'notes', 'originalPrompt', 'html']::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'technology.combination', 'technology.combination', 'Composicion de tecnologias',
  'technology-combination'::prompt_template_kind,
  'Bloque que unifica las instrucciones de varias tecnologias y resuelve conflictos.',
  'STACK: {{stack}}

INSTRUCCIONES POR TECNOLOGIA
{{instructions}}

RESTRICCIONES TECNICAS
{{constraints}}

REQUISITOS DE SALIDA
{{outputRequirements}}

CONFLICTOS RESUELTOS
{{conflicts}}',
  array['stack', 'instructions', 'constraints', 'outputRequirements', 'conflicts']::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;

insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (
  'code-reviewer.user', 'code-reviewer.user', 'Usuario: revision de codigo',
  'code-reviewer'::prompt_template_kind,
  'Revision centrada en calidad de codigo y semantica del HTML generado.',
  'Revisa este documento HTML como haria un revisor de codigo senior.
Busca: HTML no semantico, atributos de accesibilidad ausentes, CSS duplicado,
JavaScript que falla, dependencias no declaradas y elementos que no hacen nada.

{{html}}

Devuelve JSON con la misma forma que el Critic Engine.',
  array['html']::text[], true
) on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  description = excluded.description,
  template = excluded.template,
  variables = excluded.variables;
