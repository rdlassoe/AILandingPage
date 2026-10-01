import 'server-only';

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import {
  fromGeneration,
  fromLandingImage,
  fromLandingPage,
  fromLandingVersion,
  fromProject,
  fromPrompt,
  fromPromptVersion,
  fromReview,
  fromTechnology,
  toGeneration,
  toLandingImage,
  toLandingPage,
  toLandingVersion,
  toProfile,
  toProject,
  toPrompt,
  toPromptTemplate,
  toPromptVersion,
  toReview,
  toTechnology,
} from './supabase-mappers';
import type {
  DashboardStats,
  DataStore,
  GenerationFilter,
  GenerationPatch,
  GlobalSearchResults,
  LandingFilter,
  LandingPagePatch,
  NewGeneration,
  NewGenerationReview,
  NewLandingImage,
  NewLandingPage,
  NewLandingVersion,
  NewProject,
  NewPrompt,
  NewPromptVersion,
  NewTechnology,
  ProjectFilter,
  ProjectPatch,
  PromptFilter,
  PromptPatch,
  TechnologyPatch,
} from './types';
import { AppException, notFound } from '@/lib/errors';
import { IMAGES_BUCKET } from '@/lib/images/constants';
import { newId, slugify } from '@/lib/utils';
import type {
  Generation,
  GenerationReview,
  LandingImage,
  LandingPage,
  LandingVersion,
  Profile,
  Project,
  Prompt,
  PromptTemplate,
  PromptVersion,
  Technology,
} from '@/types/domain';

type Row = Record<string, unknown>;

/**
 * Implementacion de `DataStore` sobre Supabase/PostgreSQL.
 *
 * La seguridad efectiva la aplica Row Level Security (ver
 * `supabase/schema.sql`): aqui se filtra tambien por `owner_id` para que la
 * intencion sea explicita en el codigo, pero nunca se confia unicamente en
 * el frontend ni en estos filtros.
 */
export class SupabaseDataStore implements DataStore {
  readonly mode = 'supabase' as const;

  constructor(private readonly db: SupabaseClient) {}

  /* ----------------------------------------------------------- utilidades */

  private fail(error: PostgrestError, what: string): never {
    throw new AppException({
      code: 'storage_error',
      message: `No pudimos ${what}.`,
      detail: `${error.code}: ${error.message}`,
      retryable: true,
    });
  }

  private rows(data: unknown): Row[] {
    return Array.isArray(data) ? (data as Row[]) : [];
  }

  /* ---------------------------------------------------------------- Perfil */

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.db.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) this.fail(error, 'leer tu perfil');
    return data ? toProfile(data as Row) : null;
  }

  async ensureProfile(userId: string, email: string, displayName: string): Promise<Profile> {
    const existing = await this.getProfile(userId);
    if (existing) return existing;

    const { data, error } = await this.db
      .from('profiles')
      .upsert({ id: userId, email, display_name: displayName }, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) this.fail(error, 'crear tu perfil');
    return toProfile(data as Row);
  }

  async updateProfile(
    userId: string,
    patch: Partial<Pick<Profile, 'displayName' | 'preferredProvider' | 'preferredModel'>>,
  ): Promise<Profile> {
    const payload: Row = {};
    if (patch.displayName !== undefined) payload.display_name = patch.displayName;
    if (patch.preferredProvider !== undefined) payload.preferred_provider = patch.preferredProvider;
    if (patch.preferredModel !== undefined) payload.preferred_model = patch.preferredModel;

    const { data, error } = await this.db
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select('*')
      .single();
    if (error) this.fail(error, 'guardar tus preferencias');
    return toProfile(data as Row);
  }

  /* ----------------------------------------------------------- Tecnologias */

  async listTechnologies(userId: string | null): Promise<Technology[]> {
    const query = this.db.from('technologies').select('*').eq('is_active', true).order('sort_order');
    const { data, error } = userId
      ? await query.or(`owner_id.is.null,owner_id.eq.${userId}`)
      : await query.is('owner_id', null);
    if (error) this.fail(error, 'cargar las tecnologias');
    return this.rows(data).map(toTechnology);
  }

  async getTechnologiesByIds(ids: string[]): Promise<Technology[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.db.from('technologies').select('*').in('id', ids).order('sort_order');
    if (error) this.fail(error, 'cargar las tecnologias seleccionadas');
    return this.rows(data).map(toTechnology);
  }

  async createTechnology(userId: string, input: NewTechnology): Promise<Technology> {
    const payload = fromTechnology({ ...input, ownerId: userId });
    payload.id = input.id ?? crypto.randomUUID();
    payload.slug = input.slug || slugify(input.name);
    const { data, error } = await this.db.from('technologies').insert(payload).select('*').single();
    if (error) this.fail(error, 'crear la tecnologia');
    return toTechnology(data as Row);
  }

  async updateTechnology(userId: string, id: string, patch: TechnologyPatch): Promise<Technology> {
    const { data, error } = await this.db
      .from('technologies')
      .update(fromTechnology(patch))
      .eq('id', id)
      .eq('owner_id', userId)
      .select('*')
      .maybeSingle();
    if (error) this.fail(error, 'actualizar la tecnologia');
    if (!data) throw notFound('esa tecnologia entre las tuyas');
    return toTechnology(data as Row);
  }

  async deleteTechnology(userId: string, id: string): Promise<void> {
    const { error } = await this.db.from('technologies').delete().eq('id', id).eq('owner_id', userId);
    if (error) this.fail(error, 'eliminar la tecnologia');
  }

  /* ------------------------------------------------------------- Proyectos */

  async listProjects(userId: string, filter: ProjectFilter = {}): Promise<Project[]> {
    let query = this.db
      .from('projects')
      .select('*')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });

    if (filter.status) query = query.eq('status', filter.status);
    if (filter.search) query = query.ilike('basics->>name', `%${filter.search}%`);
    if (filter.limit) query = query.limit(filter.limit);

    const { data, error } = await query;
    if (error) this.fail(error, 'cargar tus proyectos');

    let items = this.rows(data).map(toProject);
    if (filter.technologyId) {
      items = items.filter((p) => p.technical.technologyIds?.includes(filter.technologyId as string));
    }
    return items;
  }

  async getProject(userId: string, id: string): Promise<Project | null> {
    const { data, error } = await this.db
      .from('projects')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .maybeSingle();
    if (error) this.fail(error, 'cargar el proyecto');
    return data ? toProject(data as Row) : null;
  }

  async createProject(userId: string, input: NewProject): Promise<Project> {
    const payload = fromProject({ ...input, ownerId: userId });
    const { data, error } = await this.db.from('projects').insert(payload).select('*').single();
    if (error) this.fail(error, 'crear el proyecto');
    const project = toProject(data as Row);
    await this.syncProjectTechnologies(project.id, input.technical?.technologyIds ?? []);
    return project;
  }

  async updateProject(userId: string, id: string, patch: ProjectPatch): Promise<Project> {
    const { data, error } = await this.db
      .from('projects')
      .update(fromProject(patch))
      .eq('id', id)
      .eq('owner_id', userId)
      .select('*')
      .maybeSingle();
    if (error) this.fail(error, 'guardar el proyecto');
    if (!data) throw notFound('ese proyecto');
    const project = toProject(data as Row);
    if (patch.technical?.technologyIds) {
      await this.syncProjectTechnologies(project.id, patch.technical.technologyIds);
    }
    return project;
  }

  async deleteProject(userId: string, id: string): Promise<void> {
    const { error } = await this.db.from('projects').delete().eq('id', id).eq('owner_id', userId);
    if (error) this.fail(error, 'eliminar el proyecto');
  }

  /**
   * `project_technologies` es el indice relacional que permite consultar
   * "que proyectos usan Next.js" sin recorrer JSON. La lista tambien viaja
   * dentro de `projects.technical` para que el mapeo al dominio sea directo.
   */
  private async syncProjectTechnologies(projectId: string, technologyIds: string[]): Promise<void> {
    await this.db.from('project_technologies').delete().eq('project_id', projectId);
    if (technologyIds.length === 0) return;
    const rows = technologyIds.map((technologyId, index) => ({
      project_id: projectId,
      technology_id: technologyId,
      position: index,
    }));
    await this.db.from('project_technologies').insert(rows);
  }

  /* --------------------------------------------------------------- Prompts */

  async listPrompts(userId: string, filter: PromptFilter = {}): Promise<Prompt[]> {
    let query = this.db
      .from('prompts')
      .select('*')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });

    if (filter.projectId) query = query.eq('project_id', filter.projectId);
    if (filter.technologyId) query = query.contains('technology_ids', [filter.technologyId]);
    if (filter.tag) query = query.contains('tags', [filter.tag]);
    if (filter.search) query = query.ilike('name', `%${filter.search}%`);
    if (filter.limit) query = query.limit(filter.limit);

    const { data, error } = await query;
    if (error) this.fail(error, 'cargar tus prompts');
    return this.rows(data).map(toPrompt);
  }

  async getPrompt(userId: string, id: string): Promise<Prompt | null> {
    const { data, error } = await this.db
      .from('prompts')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .maybeSingle();
    if (error) this.fail(error, 'cargar el prompt');
    return data ? toPrompt(data as Row) : null;
  }

  async createPrompt(userId: string, input: NewPrompt): Promise<Prompt> {
    const payload = fromPrompt({ ...input, ownerId: userId, currentVersion: 0 });
    const { data, error } = await this.db.from('prompts').insert(payload).select('*').single();
    if (error) this.fail(error, 'crear el prompt');
    return toPrompt(data as Row);
  }

  async updatePrompt(userId: string, id: string, patch: PromptPatch): Promise<Prompt> {
    const { data, error } = await this.db
      .from('prompts')
      .update(fromPrompt(patch))
      .eq('id', id)
      .eq('owner_id', userId)
      .select('*')
      .maybeSingle();
    if (error) this.fail(error, 'guardar el prompt');
    if (!data) throw notFound('ese prompt');
    return toPrompt(data as Row);
  }

  async deletePrompt(userId: string, id: string): Promise<void> {
    const { error } = await this.db.from('prompts').delete().eq('id', id).eq('owner_id', userId);
    if (error) this.fail(error, 'eliminar el prompt');
  }

  async listPromptVersions(userId: string, promptId: string): Promise<PromptVersion[]> {
    const { data, error } = await this.db
      .from('prompt_versions')
      .select('*')
      .eq('prompt_id', promptId)
      .eq('owner_id', userId)
      .order('version', { ascending: false });
    if (error) this.fail(error, 'cargar las versiones del prompt');
    return this.rows(data).map(toPromptVersion);
  }

  async getPromptVersion(userId: string, id: string): Promise<PromptVersion | null> {
    const { data, error } = await this.db
      .from('prompt_versions')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .maybeSingle();
    if (error) this.fail(error, 'cargar la version del prompt');
    return data ? toPromptVersion(data as Row) : null;
  }

  async createPromptVersion(userId: string, input: NewPromptVersion): Promise<PromptVersion> {
    const prompt = await this.getPrompt(userId, input.promptId);
    if (!prompt) throw notFound('el prompt asociado');

    const nextVersion = prompt.currentVersion + 1;
    const payload = fromPromptVersion({ ...input, ownerId: userId, version: nextVersion });
    const { data, error } = await this.db.from('prompt_versions').insert(payload).select('*').single();
    if (error) this.fail(error, 'guardar la version del prompt');

    await this.db
      .from('prompts')
      .update({ current_version: nextVersion })
      .eq('id', input.promptId)
      .eq('owner_id', userId);

    return toPromptVersion(data as Row);
  }

  /* ------------------------------------------------------------ Plantillas */

  async listPromptTemplates(): Promise<PromptTemplate[]> {
    const { data, error } = await this.db.from('prompt_templates').select('*').eq('is_active', true);
    if (error) this.fail(error, 'cargar las plantillas de prompt');
    return this.rows(data).map(toPromptTemplate);
  }

  async getPromptTemplate(key: string): Promise<PromptTemplate | null> {
    const { data, error } = await this.db.from('prompt_templates').select('*').eq('key', key).maybeSingle();
    if (error) this.fail(error, 'cargar la plantilla de prompt');
    return data ? toPromptTemplate(data as Row) : null;
  }

  /* ---------------------------------------------------------- Generaciones */

  async listGenerations(userId: string, filter: GenerationFilter = {}): Promise<Generation[]> {
    let query = this.db
      .from('generations')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (filter.projectId) query = query.eq('project_id', filter.projectId);
    if (filter.promptId) query = query.eq('prompt_id', filter.promptId);
    if (filter.limit) query = query.limit(filter.limit);

    const { data, error } = await query;
    if (error) this.fail(error, 'cargar el historial de generaciones');
    return this.rows(data).map(toGeneration);
  }

  async getGeneration(userId: string, id: string): Promise<Generation | null> {
    const { data, error } = await this.db
      .from('generations')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .maybeSingle();
    if (error) this.fail(error, 'cargar la generacion');
    return data ? toGeneration(data as Row) : null;
  }

  async createGeneration(userId: string, input: NewGeneration): Promise<Generation> {
    const payload = fromGeneration({ ...input, ownerId: userId });
    const { data, error } = await this.db.from('generations').insert(payload).select('*').single();
    if (error) this.fail(error, 'registrar la generacion');
    return toGeneration(data as Row);
  }

  async updateGeneration(userId: string, id: string, patch: GenerationPatch): Promise<Generation> {
    const { data, error } = await this.db
      .from('generations')
      .update(fromGeneration(patch))
      .eq('id', id)
      .eq('owner_id', userId)
      .select('*')
      .maybeSingle();
    if (error) this.fail(error, 'actualizar la generacion');
    if (!data) throw notFound('esa generacion');
    return toGeneration(data as Row);
  }

  async findCachedGeneration(userId: string, cacheKey: string): Promise<Generation | null> {
    const { data, error } = await this.db
      .from('generations')
      .select('*')
      .eq('owner_id', userId)
      .eq('cache_key', cacheKey)
      .eq('status', 'success')
      .not('landing_page_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) this.fail(error, 'consultar la cache de generaciones');
    const row = this.rows(data)[0];
    return row ? toGeneration(row) : null;
  }

  /* --------------------------------------------------------- Landing pages */

  async listLandingPages(userId: string, filter: LandingFilter = {}): Promise<LandingPage[]> {
    let query = this.db
      .from('landing_pages')
      .select('*')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });

    if (filter.projectId) query = query.eq('project_id', filter.projectId);
    if (filter.status) query = query.eq('status', filter.status);
    if (filter.providerId) query = query.eq('provider_id', filter.providerId);
    if (filter.category) query = query.eq('category', filter.category);
    if (filter.technologyId) query = query.contains('technology_ids', [filter.technologyId]);
    if (filter.search) query = query.ilike('name', `%${filter.search}%`);
    if (filter.limit) query = query.limit(filter.limit);

    const { data, error } = await query;
    if (error) this.fail(error, 'cargar tus Landing Pages');
    return this.rows(data).map(toLandingPage);
  }

  async listPublicLandingPages(filter: LandingFilter = {}): Promise<LandingPage[]> {
    let query = this.db
      .from('landing_pages')
      .select('*')
      .in('status', ['public', 'featured'])
      .order('updated_at', { ascending: false });

    if (filter.projectId) query = query.eq('project_id', filter.projectId);
    if (filter.providerId) query = query.eq('provider_id', filter.providerId);
    if (filter.category) query = query.eq('category', filter.category);
    if (filter.technologyId) query = query.contains('technology_ids', [filter.technologyId]);
    if (filter.search) query = query.ilike('name', `%${filter.search}%`);
    if (filter.limit) query = query.limit(filter.limit);

    const { data, error } = await query;
    if (error) this.fail(error, 'cargar la biblioteca publica');
    return this.rows(data).map(toLandingPage);
  }

  async getLandingPage(userId: string | null, id: string): Promise<LandingPage | null> {
    // RLS permite leer las propias y las publicas; no hace falta filtrar aqui.
    const { data, error } = await this.db.from('landing_pages').select('*').eq('id', id).maybeSingle();
    if (error) this.fail(error, 'cargar la Landing Page');
    if (!data) return null;
    const landing = toLandingPage(data as Row);
    const isPublic = landing.status === 'public' || landing.status === 'featured';
    if (!isPublic && landing.ownerId !== userId) return null;
    return landing;
  }

  async createLandingPage(userId: string, input: NewLandingPage): Promise<LandingPage> {
    const payload = fromLandingPage({ ...input, ownerId: userId, currentVersion: 1 });
    const { data, error } = await this.db.from('landing_pages').insert(payload).select('*').single();
    if (error) this.fail(error, 'guardar la Landing Page');
    return toLandingPage(data as Row);
  }

  async updateLandingPage(userId: string, id: string, patch: LandingPagePatch): Promise<LandingPage> {
    const { data, error } = await this.db
      .from('landing_pages')
      .update(fromLandingPage(patch))
      .eq('id', id)
      .eq('owner_id', userId)
      .select('*')
      .maybeSingle();
    if (error) this.fail(error, 'actualizar la Landing Page');
    if (!data) throw notFound('esa Landing Page');
    return toLandingPage(data as Row);
  }

  async deleteLandingPage(userId: string, id: string): Promise<void> {
    const { error } = await this.db.from('landing_pages').delete().eq('id', id).eq('owner_id', userId);
    if (error) this.fail(error, 'eliminar la Landing Page');
  }

  async listLandingVersions(userId: string, landingPageId: string): Promise<LandingVersion[]> {
    const { data, error } = await this.db
      .from('landing_versions')
      .select('*')
      .eq('landing_page_id', landingPageId)
      .eq('owner_id', userId)
      .order('version', { ascending: false });
    if (error) this.fail(error, 'cargar las versiones de la Landing Page');
    return this.rows(data).map(toLandingVersion);
  }

  async createLandingVersion(userId: string, input: NewLandingVersion): Promise<LandingVersion> {
    const existing = await this.listLandingVersions(userId, input.landingPageId);
    const nextVersion = existing.reduce((max, v) => Math.max(max, v.version), 0) + 1;

    const payload = fromLandingVersion({ ...input, ownerId: userId, version: nextVersion });
    const { data, error } = await this.db.from('landing_versions').insert(payload).select('*').single();
    if (error) this.fail(error, 'guardar la version de la Landing Page');

    await this.db
      .from('landing_pages')
      .update({ current_version: nextVersion })
      .eq('id', input.landingPageId)
      .eq('owner_id', userId);

    return toLandingVersion(data as Row);
  }

  /* ------------------------------------------------------------- Imagenes */

  /**
   * Bytes al bucket publico (clave = id) y metadatos a `landing_images`. La
   * subida va con el cliente del usuario: la politica de `storage.objects`
   * (ver `supabase/policies.sql`) solo deja escribir en este bucket.
   */
  async saveLandingImage(userId: string, input: NewLandingImage): Promise<LandingImage> {
    const { data, ...metadata } = input;
    const id = newId();

    const uploaded = await this.db.storage.from(IMAGES_BUCKET).upload(id, data, {
      contentType: input.mime,
      upsert: false,
      cacheControl: '31536000',
    });
    if (uploaded.error) {
      throw new AppException({
        code: 'storage_error',
        message: 'No pudimos guardar la imagen.',
        detail: uploaded.error.message,
        retryable: true,
      });
    }

    const payload = fromLandingImage({ ...metadata, id, ownerId: userId, bytes: data.byteLength });
    const { data: row, error } = await this.db.from('landing_images').insert(payload).select('*').single();
    if (error) {
      // Sin fila no hay quien vuelva a referenciar el objeto: se retira para no dejar huerfanos.
      await this.db.storage.from(IMAGES_BUCKET).remove([id]);
      this.fail(error, 'registrar la imagen');
    }
    return toLandingImage(row as Row);
  }

  /* ------------------------------------------------------------ Revisiones */

  async listReviews(userId: string, landingPageId: string): Promise<GenerationReview[]> {
    const { data, error } = await this.db
      .from('generation_reviews')
      .select('*')
      .eq('landing_page_id', landingPageId)
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });
    if (error) this.fail(error, 'cargar las revisiones');
    return this.rows(data).map(toReview);
  }

  async getReview(userId: string, id: string): Promise<GenerationReview | null> {
    const { data, error } = await this.db
      .from('generation_reviews')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .maybeSingle();
    if (error) this.fail(error, 'cargar la revision');
    return data ? toReview(data as Row) : null;
  }

  async createReview(userId: string, input: NewGenerationReview): Promise<GenerationReview> {
    const payload = fromReview({ ...input, ownerId: userId });
    const { data, error } = await this.db.from('generation_reviews').insert(payload).select('*').single();
    if (error) this.fail(error, 'guardar la revision');
    return toReview(data as Row);
  }

  /* ------------------------------------------------------------- Agregados */

  async getDashboardStats(userId: string): Promise<DashboardStats> {
    const [projects, landings, prompts, generations] = await Promise.all([
      this.db.from('projects').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      this.db.from('landing_pages').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      this.db.from('prompts').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      this.db
        .from('generations')
        .select('status,is_mock,latency_ms,created_at')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const generationRows = this.rows(generations.data);
    const successful = generationRows.filter((g) => g.status === 'success');
    const latencies = successful
      .map((g) => (typeof g.latency_ms === 'number' ? g.latency_ms : 0))
      .filter((v) => v > 0);

    return {
      projects: projects.count ?? 0,
      landingPages: landings.count ?? 0,
      prompts: prompts.count ?? 0,
      generations: generationRows.length,
      successfulGenerations: successful.length,
      mockGenerations: generationRows.filter((g) => g.is_mock === true).length,
      lastGenerationAt: typeof generationRows[0]?.created_at === 'string' ? generationRows[0].created_at : null,
      averageLatencyMs:
        latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    };
  }

  async search(userId: string, query: string): Promise<GlobalSearchResults> {
    const like = `%${query}%`;
    const [projects, prompts, landings, technologies] = await Promise.all([
      this.db.from('projects').select('*').eq('owner_id', userId).ilike('basics->>name', like).limit(5),
      this.db.from('prompts').select('*').eq('owner_id', userId).ilike('name', like).limit(5),
      this.db.from('landing_pages').select('*').eq('owner_id', userId).ilike('name', like).limit(5),
      this.db.from('technologies').select('*').ilike('name', like).limit(5),
    ]);

    return {
      projects: this.rows(projects.data).map(toProject),
      prompts: this.rows(prompts.data).map(toPrompt),
      landingPages: this.rows(landings.data).map(toLandingPage),
      technologies: this.rows(technologies.data).map(toTechnology),
    };
  }
}
