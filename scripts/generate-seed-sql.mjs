/**
 * Genera `supabase/seed.sql` a partir del catalogo que usa la aplicacion.
 *
 * El objetivo es que no existan dos fuentes de verdad: las tecnologias, las
 * Seed Strings y las plantillas de prompt se declaran una sola vez en
 * `src/lib/data/`, y el SQL de Supabase se deriva de ahi.
 *
 *   npm run seed:sql
 *
 * Funciona porque esos modulos solo usan `import type`, que Node elimina al
 * cargar TypeScript directamente.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { PRESET_TECHNOLOGIES, LANDING_CATEGORIES } = await import(
  pathToFileURL(join(root, 'src/lib/data/catalog.ts')).href
);
const { PRESET_PROMPT_TEMPLATES } = await import(
  pathToFileURL(join(root, 'src/lib/data/prompt-templates.ts')).href
);
const { GEMINI_MODELS, GROQ_MODELS, OLLAMA_MODELS, MOCK_MODELS } = await import(
  pathToFileURL(join(root, 'src/lib/llm/models.ts')).href
);

/** Literal de texto SQL con comillas simples escapadas. */
const s = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;
const nullable = (value) => (value === null || value === undefined || value === '' ? 'null' : s(value));
const arr = (values) => `array[${(values ?? []).map(s).join(', ')}]::text[]`;
const json = (value) => `${s(JSON.stringify(value ?? {}))}::jsonb`;
const bool = (value) => (value ? 'true' : 'false');

const slugify = (value) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const lines = [];
const push = (...text) => lines.push(...text);

push(
  '-- ===========================================================================',
  '-- AI LANDING STUDIO - Datos iniciales',
  '--',
  '-- ARCHIVO GENERADO. No editar a mano.',
  '-- Se regenera con:  npm run seed:sql',
  '-- Fuente: src/lib/data/catalog.ts y src/lib/data/prompt-templates.ts',
  '--',
  '-- Es idempotente: puede ejecutarse varias veces sobre la misma base.',
  '-- ===========================================================================',
  '',
  '-- ---------------------------------------------------------------------------',
  '-- Proveedores y modelos (catalogo informativo; la disponibilidad real la',
  '-- decide el servidor segun las variables de entorno)',
  '-- ---------------------------------------------------------------------------',
  '',
  'insert into llm_providers (id, label, docs_url, env_key, is_enabled) values',
  "  ('mock',   'Modo demo (sin IA)', '',                                        null,             true),",
  "  ('gemini', 'Google Gemini',      'https://aistudio.google.com/apikey',      'GEMINI_API_KEY', true),",
  "  ('groq',   'Groq',               'https://console.groq.com/keys',           'GROQ_API_KEY',   true),",
  "  ('ollama', 'Ollama (local)',     'https://ollama.com/download',             null,             true)",
  'on conflict (id) do update set',
  '  label = excluded.label,',
  '  docs_url = excluded.docs_url,',
  '  env_key = excluded.env_key;',
  '',
);

// El catalogo de modelos se deriva del mismo modulo que usan los adaptadores
// (src/lib/llm/models.ts): no hay dos listas que mantener sincronizadas.
const MODELS = [
  ...MOCK_MODELS.map((m) => ['mock', m]),
  ...GEMINI_MODELS.map((m) => ['gemini', m]),
  ...GROQ_MODELS.map((m) => ['groq', m]),
  ...OLLAMA_MODELS.map((m) => ['ollama', m]),
];

push(
  'insert into llm_models (id, provider_id, label, context_window, max_output_tokens, good_for_long_output, description) values',
  MODELS.map(
    ([provider, m]) =>
      `  (${s(m.id)}, ${s(provider)}, ${s(m.label)}, ${m.contextWindow}, ${m.maxOutputTokens}, ` +
      `${bool(m.goodForLongOutput)}, ${s(m.description ?? '')})`,
  ).join(',\n'),
  'on conflict (id) do update set',
  '  label = excluded.label,',
  '  context_window = excluded.context_window,',
  '  max_output_tokens = excluded.max_output_tokens,',
  '  good_for_long_output = excluded.good_for_long_output,',
  '  description = excluded.description;',
  '',
  // Los proveedores retiran identificadores sin avisar (ver docs/LLM_PROVIDERS.md);
  // sin este delete, cada modelo que sale del catalogo de src/lib/llm/models.ts
  // queda para siempre como fila huerfana en Supabase. `id` es la clave primaria
  // y es unica entre proveedores, asi que basta con filtrar por la lista completa
  // de ids vigentes. Nada mas en el esquema referencia llm_models.id, asi que
  // borrar aqui no afecta generaciones ni landing pages ya guardadas.
  '-- Retira del catalogo los modelos que ya no existen en el codigo.',
  `delete from llm_models where id not in (${MODELS.map(([, m]) => s(m.id)).join(', ')});`,
  '',
  '-- ---------------------------------------------------------------------------',
  '-- Categorias de Landing Page',
  '-- ---------------------------------------------------------------------------',
  '',
  'insert into landing_categories (slug, label) values',
  LANDING_CATEGORIES.map((label) => `  (${s(slugify(label))}, ${s(label)})`).join(',\n'),
  'on conflict (slug) do update set label = excluded.label;',
  '',
  '-- ---------------------------------------------------------------------------',
  `-- Tecnologias (${PRESET_TECHNOLOGIES.length})`,
  '-- owner_id null = catalogo comun, de solo lectura para los usuarios',
  '-- ---------------------------------------------------------------------------',
  '',
);

for (const tech of PRESET_TECHNOLOGIES) {
  push(
    'insert into technologies (',
    '  id, slug, name, description, category, version, prompt_instructions,',
    '  constraints, output_requirements, conflicts_with, priority,',
    '  self_contained_preview, is_active, sort_order, owner_id',
    ') values (',
    `  ${s(tech.id)}, ${s(tech.slug)}, ${s(tech.name)}, ${s(tech.description)},`,
    `  ${s(tech.category)}::technology_category, ${nullable(tech.version)},`,
    `  ${s(tech.promptInstructions)},`,
    `  ${arr(tech.constraints)}, ${arr(tech.outputRequirements)}, ${arr(tech.conflictsWith)},`,
    `  ${tech.priority}, ${bool(tech.selfContainedPreview)}, ${bool(tech.isActive)}, ${tech.sortOrder}, null`,
    ') on conflict (id) do update set',
    '  name = excluded.name,',
    '  description = excluded.description,',
    '  category = excluded.category,',
    '  version = excluded.version,',
    '  prompt_instructions = excluded.prompt_instructions,',
    '  constraints = excluded.constraints,',
    '  output_requirements = excluded.output_requirements,',
    '  conflicts_with = excluded.conflicts_with,',
    '  priority = excluded.priority,',
    '  self_contained_preview = excluded.self_contained_preview,',
    '  sort_order = excluded.sort_order;',
    '',
  );
}

push(
  '-- ---------------------------------------------------------------------------',
  `-- Plantillas de prompt (${PRESET_PROMPT_TEMPLATES.length})`,
  '-- ---------------------------------------------------------------------------',
  '',
);

for (const template of PRESET_PROMPT_TEMPLATES) {
  push(
    'insert into prompt_templates (id, key, name, kind, description, template, variables, is_active) values (',
    `  ${s(template.id)}, ${s(template.key)}, ${s(template.name)},`,
    `  ${s(template.kind)}::prompt_template_kind,`,
    `  ${s(template.description)},`,
    `  ${s(template.template)},`,
    `  ${arr(template.variables)}, true`,
    ') on conflict (id) do update set',
    '  name = excluded.name,',
    '  kind = excluded.kind,',
    '  description = excluded.description,',
    '  template = excluded.template,',
    '  variables = excluded.variables;',
    '',
  );
}

const output = join(root, 'supabase', 'seed.sql');
writeFileSync(output, lines.join('\n'), 'utf8');

console.log(
  `seed.sql generado: ${PRESET_TECHNOLOGIES.length} tecnologias, ` +
    `${PRESET_PROMPT_TEMPLATES.length} plantillas, ${MODELS.length} modelos.`,
);
