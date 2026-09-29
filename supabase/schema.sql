-- ===========================================================================
-- AI LANDING STUDIO - Esquema de base de datos
--
-- Ejecutar en el SQL Editor de Supabase, en este orden:
--   1. schema.sql    (este archivo: tipos, tablas, indices, triggers)
--   2. policies.sql  (Row Level Security)
--   3. seed.sql      (catalogo inicial de tecnologias y plantillas)
--
-- Convenciones:
--   - snake_case en SQL, camelCase en el dominio (traduce supabase-mappers.ts)
--   - los objetos de valor agrupados viajan como jsonb para que el mapeo sea
--     directo; las relaciones que hay que consultar van en tablas propias
--   - todo lo que pertenece a un usuario tiene owner_id y politica RLS
-- ===========================================================================

-- No hace falta ninguna extension: `gen_random_uuid()` forma parte del nucleo
-- desde PostgreSQL 13, y Supabase va muy por encima de esa version.

-- ---------------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------------

do $$ begin
  create type provider_id as enum ('mock', 'gemini', 'groq', 'ollama');
exception when duplicate_object then null; end $$;

-- Bases creadas antes de anadir Ollama ya tienen el tipo con solo los tres
-- valores originales: esto lo pone al dia sin tocar filas existentes.
alter type provider_id add value if not exists 'ollama';

do $$ begin
  create type technology_category as enum
    ('language', 'markup', 'styling', 'framework', 'library', 'tooling', 'icons');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum ('draft', 'defined', 'generated', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type landing_status as enum ('draft', 'private', 'public', 'featured');
exception when duplicate_object then null; end $$;

do $$ begin
  create type generation_status as enum
    ('pending', 'success', 'invalid_output', 'error', 'timeout', 'rate_limited', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type generation_kind as enum
    ('landing', 'refinement', 'variation', 'critique', 'discover', 'seed', 'prompt_generation');
exception when duplicate_object then null; end $$;

-- Bases creadas antes de que el prompt y la Seed se compusieran con un LLM
-- (paso SSoT + Prompt Composer) solo tienen los 5 valores originales.
alter type generation_kind add value if not exists 'seed';
alter type generation_kind add value if not exists 'prompt_generation';

do $$ begin
  create type prompt_template_kind as enum
    ('landing-generator', 'technology', 'technology-combination', 'ux-critic', 'cro-critic',
     'accessibility-critic', 'code-reviewer', 'refinement', 'variation', 'discover');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Migracion: la Seed dejo de ser un catalogo semantico curado y paso a ser un
-- string aleatorio generado en cada ejecucion (ver docs/SEED_ENGINE_MIGRATION.md).
-- Bases creadas antes de este cambio todavia tienen seed_strings, el tipo
-- seed_category y las columnas de projects: se retiran aqui.
-- DESTRUCTIVO: borra cualquier dato que quedara en esas columnas/tabla.
-- El orden importa: primero la columna que referencia seed_strings (arrastra
-- su FK), luego la tabla, luego el tipo que usaba esa tabla.
-- ---------------------------------------------------------------------------

alter table if exists projects drop column if exists seed_string_id;
alter table if exists projects drop column if exists seed_string_value;
drop table if exists seed_strings;
drop type if exists seed_category;

-- ---------------------------------------------------------------------------
-- Utilidad: updated_at automatico
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text not null,
  display_name       text not null default '',
  preferred_provider provider_id not null default 'mock',
  preferred_model    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Alta automatica del perfil al registrarse
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'usuario'), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- technologies
-- owner_id null = tecnologia del catalogo, visible para todos y de solo lectura
-- ---------------------------------------------------------------------------

create table if not exists technologies (
  id                     text primary key,
  slug                   text not null,
  name                   text not null,
  description            text not null default '',
  category               technology_category not null,
  version                text,
  prompt_instructions    text not null default '',
  constraints            text[] not null default '{}',
  output_requirements    text[] not null default '{}',
  conflicts_with         text[] not null default '{}',
  priority               integer not null default 10,
  self_contained_preview boolean not null default true,
  is_active              boolean not null default true,
  sort_order             integer not null default 100,
  owner_id               uuid references profiles(id) on delete cascade,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists technologies_slug_owner_idx
  on technologies (slug, coalesce(owner_id::text, 'catalog'));
create index if not exists technologies_owner_idx on technologies (owner_id);
create index if not exists technologies_active_idx on technologies (is_active, sort_order);

drop trigger if exists technologies_updated_at on technologies;
create trigger technologies_updated_at before update on technologies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- landing_categories (catalogo de apoyo para filtros)
-- ---------------------------------------------------------------------------

create table if not exists landing_categories (
  slug  text primary key,
  label text not null
);

-- ---------------------------------------------------------------------------
-- prompt_templates (plantillas internas del Prompt Engine)
-- ---------------------------------------------------------------------------

create table if not exists prompt_templates (
  id          text primary key,
  key         text not null unique,
  name        text not null,
  kind        prompt_template_kind not null,
  description text not null default '',
  template    text not null,
  variables   text[] not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists prompt_templates_updated_at on prompt_templates;
create trigger prompt_templates_updated_at before update on prompt_templates
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table if not exists projects (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references profiles(id) on delete cascade,
  status               project_status not null default 'draft',
  basics               jsonb not null default '{}'::jsonb,
  visual               jsonb not null default '{}'::jsonb,
  technical            jsonb not null default '{}'::jsonb,
  content              jsonb not null default '{}'::jsonb,
  negative_constraints text[] not null default '{}',
  discover             jsonb,
  define               jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists projects_owner_idx on projects (owner_id, updated_at desc);
create index if not exists projects_status_idx on projects (owner_id, status);
-- Busqueda por nombre sin recorrer todo el jsonb
create index if not exists projects_name_idx on projects ((basics ->> 'name'));

drop trigger if exists projects_updated_at on projects;
create trigger projects_updated_at before update on projects
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- project_technologies
-- Indice relacional del stack de cada proyecto. Permite consultar "que
-- proyectos usan Next.js" sin recorrer jsonb.
-- ---------------------------------------------------------------------------

create table if not exists project_technologies (
  project_id    uuid not null references projects(id) on delete cascade,
  technology_id text not null references technologies(id) on delete cascade,
  position      integer not null default 0,
  primary key (project_id, technology_id)
);

create index if not exists project_technologies_tech_idx on project_technologies (technology_id);

-- ---------------------------------------------------------------------------
-- prompts y prompt_versions
-- ---------------------------------------------------------------------------

create table if not exists prompts (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references profiles(id) on delete cascade,
  project_id      uuid references projects(id) on delete cascade,
  name            text not null,
  description     text not null default '',
  current_version integer not null default 0,
  technology_ids  text[] not null default '{}',
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists prompts_owner_idx on prompts (owner_id, updated_at desc);
create index if not exists prompts_project_idx on prompts (project_id);
create index if not exists prompts_tech_idx on prompts using gin (technology_ids);
create index if not exists prompts_tags_idx on prompts using gin (tags);

drop trigger if exists prompts_updated_at on prompts;
create trigger prompts_updated_at before update on prompts
  for each row execute function set_updated_at();

create table if not exists prompt_versions (
  id                   uuid primary key default gen_random_uuid(),
  prompt_id            uuid not null references prompts(id) on delete cascade,
  owner_id             uuid not null references profiles(id) on delete cascade,
  version              integer not null,
  content              text not null,
  system_instruction   text not null default '',
  sections             jsonb not null default '[]'::jsonb,
  technology_ids       text[] not null default '{}',
  seed_string_value    text,
  negative_constraints text[] not null default '{}',
  conflicts            jsonb not null default '[]'::jsonb,
  provider_id          provider_id,
  model                text,
  config               jsonb,
  change_note          text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (prompt_id, version)
);

create index if not exists prompt_versions_owner_idx on prompt_versions (owner_id, created_at desc);
create index if not exists prompt_versions_prompt_idx on prompt_versions (prompt_id, version desc);

drop trigger if exists prompt_versions_updated_at on prompt_versions;
create trigger prompt_versions_updated_at before update on prompt_versions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- landing_pages y landing_versions
-- ---------------------------------------------------------------------------

create table if not exists landing_pages (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references profiles(id) on delete cascade,
  project_id        uuid references projects(id) on delete set null,
  prompt_id         uuid references prompts(id) on delete set null,
  prompt_version_id uuid references prompt_versions(id) on delete set null,
  generation_id     uuid,
  name              text not null,
  description       text not null default '',
  html              text not null,
  technology_ids    text[] not null default '{}',
  provider_id       provider_id not null default 'mock',
  model             text not null default '',
  is_mock           boolean not null default false,
  status            landing_status not null default 'draft',
  category          text,
  current_version   integer not null default 1,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists landing_pages_owner_idx on landing_pages (owner_id, updated_at desc);
create index if not exists landing_pages_public_idx on landing_pages (status) where status in ('public', 'featured');
create index if not exists landing_pages_project_idx on landing_pages (project_id);
create index if not exists landing_pages_tech_idx on landing_pages using gin (technology_ids);

drop trigger if exists landing_pages_updated_at on landing_pages;
create trigger landing_pages_updated_at before update on landing_pages
  for each row execute function set_updated_at();

create table if not exists landing_versions (
  id                uuid primary key default gen_random_uuid(),
  landing_page_id   uuid not null references landing_pages(id) on delete cascade,
  owner_id          uuid not null references profiles(id) on delete cascade,
  version           integer not null,
  html              text not null,
  label             text not null default '',
  generation_id     uuid,
  prompt_version_id uuid references prompt_versions(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (landing_page_id, version)
);

create index if not exists landing_versions_page_idx on landing_versions (landing_page_id, version desc);

drop trigger if exists landing_versions_updated_at on landing_versions;
create trigger landing_versions_updated_at before update on landing_versions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- generations (observabilidad)
-- Nunca almacena claves API: solo proveedor, modelo, estado, latencia y avisos.
-- ---------------------------------------------------------------------------

create table if not exists generations (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references profiles(id) on delete cascade,
  project_id        uuid references projects(id) on delete cascade,
  prompt_id         uuid references prompts(id) on delete set null,
  prompt_version_id uuid references prompt_versions(id) on delete set null,
  kind              generation_kind not null default 'landing',
  provider_id       provider_id not null default 'mock',
  model             text not null default '',
  status            generation_status not null default 'pending',
  is_mock           boolean not null default false,
  latency_ms        integer not null default 0,
  input_tokens      integer,
  output_tokens     integer,
  error_code        text,
  error_message     text,
  warnings          text[] not null default '{}',
  landing_page_id   uuid references landing_pages(id) on delete set null,
  config            jsonb,
  cache_key         text,
  served_from_cache boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists generations_owner_idx on generations (owner_id, created_at desc);
create index if not exists generations_project_idx on generations (project_id, created_at desc);
create index if not exists generations_cache_idx on generations (owner_id, cache_key) where status = 'success';

drop trigger if exists generations_updated_at on generations;
create trigger generations_updated_at before update on generations
  for each row execute function set_updated_at();

-- Claves cruzadas que no se pueden declarar antes de crear ambas tablas
do $$ begin
  alter table landing_pages
    add constraint landing_pages_generation_fk
    foreign key (generation_id) references generations(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table landing_versions
    add constraint landing_versions_generation_fk
    foreign key (generation_id) references generations(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- generation_reviews (Critic Engine)
-- ---------------------------------------------------------------------------

create table if not exists generation_reviews (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references profiles(id) on delete cascade,
  generation_id     uuid references generations(id) on delete set null,
  landing_page_id   uuid not null references landing_pages(id) on delete cascade,
  issues            jsonb not null default '[]'::jsonb,
  suggestions       jsonb not null default '[]'::jsonb,
  priority          text[] not null default '{}',
  scores            jsonb not null default '{}'::jsonb,
  refinement_prompt text not null default '',
  provider_id       provider_id not null default 'mock',
  model             text not null default '',
  is_mock           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists generation_reviews_page_idx on generation_reviews (landing_page_id, created_at desc);
create index if not exists generation_reviews_owner_idx on generation_reviews (owner_id, created_at desc);

drop trigger if exists generation_reviews_updated_at on generation_reviews;
create trigger generation_reviews_updated_at before update on generation_reviews
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- llm_providers y llm_models (catalogo informativo)
-- El estado real de configuracion se decide en el servidor a partir de las
-- variables de entorno: estas tablas solo describen el catalogo.
-- ---------------------------------------------------------------------------

create table if not exists llm_providers (
  id         provider_id primary key,
  label      text not null,
  docs_url   text not null default '',
  env_key    text,
  is_enabled boolean not null default true
);

create table if not exists llm_models (
  id                    text primary key,
  provider_id           provider_id not null references llm_providers(id) on delete cascade,
  label                 text not null,
  context_window        integer not null default 0,
  max_output_tokens     integer not null default 0,
  good_for_long_output  boolean not null default false,
  description           text not null default ''
);

create index if not exists llm_models_provider_idx on llm_models (provider_id);
