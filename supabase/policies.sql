-- ===========================================================================
-- AI LANDING STUDIO - Row Level Security
--
-- Regla general: un usuario solo ve y modifica sus propias filas.
-- Excepciones deliberadas:
--   - technologies / seed_strings con owner_id NULL: catalogo comun, lectura
--     para cualquier usuario autenticado, escritura prohibida.
--   - landing_pages con status 'public' o 'featured': lectura publica.
--   - prompt_templates, llm_providers, llm_models, landing_categories:
--     catalogo de solo lectura.
--
-- Ejecutar despues de schema.sql.
-- ===========================================================================

alter table profiles             enable row level security;
alter table technologies         enable row level security;
alter table seed_strings         enable row level security;
alter table prompt_templates     enable row level security;
alter table landing_categories   enable row level security;
alter table projects             enable row level security;
alter table project_technologies enable row level security;
alter table prompts              enable row level security;
alter table prompt_versions      enable row level security;
alter table landing_pages        enable row level security;
alter table landing_versions     enable row level security;
alter table generations          enable row level security;
alter table generation_reviews   enable row level security;
alter table llm_providers        enable row level security;
alter table llm_models           enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- technologies: catalogo comun + las del usuario
-- ---------------------------------------------------------------------------

drop policy if exists "technologies_select" on technologies;
create policy "technologies_select" on technologies
  for select to authenticated
  using (owner_id is null or owner_id = auth.uid());

drop policy if exists "technologies_insert_own" on technologies;
create policy "technologies_insert_own" on technologies
  for insert to authenticated
  with check (owner_id = auth.uid());

-- El catalogo (owner_id null) no se puede modificar desde la aplicacion.
drop policy if exists "technologies_update_own" on technologies;
create policy "technologies_update_own" on technologies
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "technologies_delete_own" on technologies;
create policy "technologies_delete_own" on technologies
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- seed_strings
-- ---------------------------------------------------------------------------

drop policy if exists "seeds_select" on seed_strings;
create policy "seeds_select" on seed_strings
  for select to authenticated
  using (owner_id is null or owner_id = auth.uid());

drop policy if exists "seeds_insert_own" on seed_strings;
create policy "seeds_insert_own" on seed_strings
  for insert to authenticated
  with check (owner_id = auth.uid() and is_preset = false);

drop policy if exists "seeds_update_own" on seed_strings;
create policy "seeds_update_own" on seed_strings
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "seeds_delete_own" on seed_strings;
create policy "seeds_delete_own" on seed_strings
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Catalogos de solo lectura
-- ---------------------------------------------------------------------------

drop policy if exists "prompt_templates_read" on prompt_templates;
create policy "prompt_templates_read" on prompt_templates
  for select to authenticated using (true);

drop policy if exists "landing_categories_read" on landing_categories;
create policy "landing_categories_read" on landing_categories
  for select to authenticated using (true);

drop policy if exists "llm_providers_read" on llm_providers;
create policy "llm_providers_read" on llm_providers
  for select to authenticated using (true);

drop policy if exists "llm_models_read" on llm_models;
create policy "llm_models_read" on llm_models
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

drop policy if exists "projects_all_own" on projects;
create policy "projects_all_own" on projects
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- project_technologies: se hereda del proyecto
-- ---------------------------------------------------------------------------

drop policy if exists "project_technologies_all_own" on project_technologies;
create policy "project_technologies_all_own" on project_technologies
  for all to authenticated
  using (
    exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- prompts y versiones
-- ---------------------------------------------------------------------------

drop policy if exists "prompts_all_own" on prompts;
create policy "prompts_all_own" on prompts
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "prompt_versions_all_own" on prompt_versions;
create policy "prompt_versions_all_own" on prompt_versions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- landing_pages: propias (todo) + publicas (solo lectura)
-- ---------------------------------------------------------------------------

drop policy if exists "landing_pages_select" on landing_pages;
create policy "landing_pages_select" on landing_pages
  for select
  using (owner_id = auth.uid() or status in ('public', 'featured'));

drop policy if exists "landing_pages_insert_own" on landing_pages;
create policy "landing_pages_insert_own" on landing_pages
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "landing_pages_update_own" on landing_pages;
create policy "landing_pages_update_own" on landing_pages
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "landing_pages_delete_own" on landing_pages;
create policy "landing_pages_delete_own" on landing_pages
  for delete to authenticated
  using (owner_id = auth.uid());

-- Las versiones historicas son privadas aunque la pagina sea publica:
-- solo se comparte la version vigente.
drop policy if exists "landing_versions_all_own" on landing_versions;
create policy "landing_versions_all_own" on landing_versions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- generations y revisiones
-- ---------------------------------------------------------------------------

drop policy if exists "generations_all_own" on generations;
create policy "generations_all_own" on generations
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "generation_reviews_all_own" on generation_reviews;
create policy "generation_reviews_all_own" on generation_reviews
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
