import type {
  Generation,
  GenerationReview,
  LandingPage,
  LandingStatus,
  LandingVersion,
  Profile,
  Project,
  ProjectStatus,
  Prompt,
  PromptTemplate,
  PromptVersion,
  Technology,
} from '@/types/domain';
import type { ProviderId } from '@/types/llm';

/* -------------------------------------------------------------------------
 * Entradas de escritura
 * ---------------------------------------------------------------------- */

export type NewProject = Omit<Project, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>;
export type ProjectPatch = Partial<NewProject>;

export type NewTechnology = Omit<Technology, 'id' | 'createdAt' | 'updatedAt' | 'ownerId'> & {
  id?: string;
};
export type TechnologyPatch = Partial<Omit<Technology, 'id' | 'createdAt' | 'updatedAt' | 'ownerId'>>;

export type NewPrompt = Omit<Prompt, 'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'currentVersion'>;
export type PromptPatch = Partial<Omit<Prompt, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>>;

export type NewPromptVersion = Omit<
  PromptVersion,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'version'
>;

export type NewGeneration = Omit<Generation, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>;
export type GenerationPatch = Partial<Omit<Generation, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>>;

export type NewLandingPage = Omit<
  LandingPage,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'currentVersion'
>;
export type LandingPagePatch = Partial<Omit<LandingPage, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>>;

export type NewLandingVersion = Omit<
  LandingVersion,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'version'
>;

export type NewGenerationReview = Omit<GenerationReview, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>;

/* -------------------------------------------------------------------------
 * Filtros
 * ---------------------------------------------------------------------- */

export interface ProjectFilter {
  search?: string;
  status?: ProjectStatus;
  technologyId?: string;
  limit?: number;
}

export interface PromptFilter {
  search?: string;
  projectId?: string;
  technologyId?: string;
  tag?: string;
  limit?: number;
}

export interface LandingFilter {
  search?: string;
  projectId?: string;
  technologyId?: string;
  status?: LandingStatus;
  providerId?: ProviderId;
  category?: string;
  limit?: number;
}

export interface GenerationFilter {
  projectId?: string;
  promptId?: string;
  limit?: number;
}

export interface DashboardStats {
  projects: number;
  landingPages: number;
  prompts: number;
  generations: number;
  successfulGenerations: number;
  lastGenerationAt: string | null;
  averageLatencyMs: number | null;
  mockGenerations: number;
}

export interface GlobalSearchResults {
  projects: Project[];
  prompts: Prompt[];
  landingPages: LandingPage[];
  technologies: Technology[];
}

/* -------------------------------------------------------------------------
 * Contrato del almacen
 *
 * Implementaciones:
 *  - `SupabaseDataStore` (produccion; la seguridad real la aplica RLS)
 *  - `LocalDataStore`    (desarrollo sin Supabase; persiste en ./.data)
 *
 * Todos los metodos reciben `ownerId` de forma explicita para que el
 * aislamiento por usuario sea visible en el codigo y no dependa solo de RLS.
 * ---------------------------------------------------------------------- */

export interface DataStore {
  readonly mode: 'supabase' | 'local';

  /* Perfil */
  getProfile(userId: string): Promise<Profile | null>;
  ensureProfile(userId: string, email: string, displayName: string): Promise<Profile>;
  updateProfile(
    userId: string,
    patch: Partial<Pick<Profile, 'displayName' | 'preferredProvider' | 'preferredModel'>>,
  ): Promise<Profile>;

  /* Tecnologias */
  listTechnologies(userId: string | null): Promise<Technology[]>;
  getTechnologiesByIds(ids: string[]): Promise<Technology[]>;
  createTechnology(userId: string, input: NewTechnology): Promise<Technology>;
  updateTechnology(userId: string, id: string, patch: TechnologyPatch): Promise<Technology>;
  deleteTechnology(userId: string, id: string): Promise<void>;

  /* Proyectos */
  listProjects(userId: string, filter?: ProjectFilter): Promise<Project[]>;
  getProject(userId: string, id: string): Promise<Project | null>;
  createProject(userId: string, input: NewProject): Promise<Project>;
  updateProject(userId: string, id: string, patch: ProjectPatch): Promise<Project>;
  deleteProject(userId: string, id: string): Promise<void>;

  /* Prompts */
  listPrompts(userId: string, filter?: PromptFilter): Promise<Prompt[]>;
  getPrompt(userId: string, id: string): Promise<Prompt | null>;
  createPrompt(userId: string, input: NewPrompt): Promise<Prompt>;
  updatePrompt(userId: string, id: string, patch: PromptPatch): Promise<Prompt>;
  deletePrompt(userId: string, id: string): Promise<void>;

  listPromptVersions(userId: string, promptId: string): Promise<PromptVersion[]>;
  getPromptVersion(userId: string, id: string): Promise<PromptVersion | null>;
  createPromptVersion(userId: string, input: NewPromptVersion): Promise<PromptVersion>;

  /* Plantillas de prompt */
  listPromptTemplates(): Promise<PromptTemplate[]>;
  getPromptTemplate(key: string): Promise<PromptTemplate | null>;

  /* Generaciones */
  listGenerations(userId: string, filter?: GenerationFilter): Promise<Generation[]>;
  getGeneration(userId: string, id: string): Promise<Generation | null>;
  createGeneration(userId: string, input: NewGeneration): Promise<Generation>;
  updateGeneration(userId: string, id: string, patch: GenerationPatch): Promise<Generation>;
  findCachedGeneration(userId: string, cacheKey: string): Promise<Generation | null>;

  /* Landing pages */
  listLandingPages(userId: string, filter?: LandingFilter): Promise<LandingPage[]>;
  listPublicLandingPages(filter?: LandingFilter): Promise<LandingPage[]>;
  getLandingPage(userId: string | null, id: string): Promise<LandingPage | null>;
  createLandingPage(userId: string, input: NewLandingPage): Promise<LandingPage>;
  updateLandingPage(userId: string, id: string, patch: LandingPagePatch): Promise<LandingPage>;
  deleteLandingPage(userId: string, id: string): Promise<void>;

  listLandingVersions(userId: string, landingPageId: string): Promise<LandingVersion[]>;
  createLandingVersion(userId: string, input: NewLandingVersion): Promise<LandingVersion>;

  /* Revisiones del Critic Engine */
  listReviews(userId: string, landingPageId: string): Promise<GenerationReview[]>;
  getReview(userId: string, id: string): Promise<GenerationReview | null>;
  createReview(userId: string, input: NewGenerationReview): Promise<GenerationReview>;

  /* Agregados */
  getDashboardStats(userId: string): Promise<DashboardStats>;
  search(userId: string, query: string): Promise<GlobalSearchResults>;
}
