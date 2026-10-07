import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PRESET_TECHNOLOGIES } from './catalog';
import { PRESET_PROMPT_TEMPLATES } from './prompt-templates';
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
import { forbidden, notFound } from '@/lib/errors';
import { IMAGE_EXTENSIONS } from '@/lib/images/constants';
import { isImageId } from '@/lib/images/slots';
import { newId, nowIso } from '@/lib/utils';
import type {
  Generation,
  GenerationReview,
  LandingImage,
  LandingImageMime,
  LandingPage,
  LandingVersion,
  Profile,
  Project,
  Prompt,
  PromptTemplate,
  PromptVersion,
  Technology,
} from '@/types/domain';

/**
 * Almacen de desarrollo en disco.
 *
 * DECISION ARQUITECTONICA
 * -----------------------
 * Decision : la persistencia pasa por la interfaz `DataStore`, con dos
 *            implementaciones intercambiables (Supabase y local en JSON).
 * Motivo   : el criterio de aceptacion exige que el flujo completo funcione
 *            sin depender de servicios externos. Con esta capa, `npm run dev`
 *            arranca y permite recorrer todo el flujo sin crear un proyecto
 *            en Supabase; en cuanto se rellenan las variables de entorno, la
 *            aplicacion usa Supabase sin tocar una sola linea de UI.
 * Alternativas consideradas:
 *            - Solo Supabase: rompe el arranque en frio del evaluador.
 *            - SQLite: anade dependencia nativa y un segundo dialecto SQL.
 *            - Memoria volatil: se pierde el trabajo en cada recarga del
 *              servidor de desarrollo.
 *
 * Este almacen NO esta pensado para produccion: no hay concurrencia real ni
 * transacciones. Produccion = Supabase + RLS.
 */

interface LocalDb {
  version: number;
  profiles: Profile[];
  technologies: Technology[];
  promptTemplates: PromptTemplate[];
  projects: Project[];
  prompts: Prompt[];
  promptVersions: PromptVersion[];
  generations: Generation[];
  landingPages: LandingPage[];
  landingVersions: LandingVersion[];
  reviews: GenerationReview[];
  /** Solo metadatos: los bytes van a `.data/images/<id>.<ext>`, no a este JSON. */
  landingImages: LandingImage[];
  /**
   * Credenciales de proveedores por usuario, CIFRADAS (AES-256-GCM). La clave esta en
   * `.data/credentials.key` o en `CREDENTIALS_ENCRYPTION_KEY`, nunca en este archivo: una copia
   * de `db.json` no basta para leerlas.
   */
  credentials: Record<string, string>;
}

const DB_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DB_DIR, 'db.json');
const IMAGES_DIR = path.join(DB_DIR, 'images');

/**
 * Lectura de una imagen generada por su id, SIN sesion ni propietario: el id
 * (uuid v4) es la capacidad de lectura, porque el iframe sandbox de la vista
 * previa no envia cookies. Solo la usa `GET /api/landing-images/[id]`; por eso
 * no forma parte de `DataStore`, cuyos metodos reciben todos `ownerId`.
 *
 * `isImageId` va primero: un `../` nunca llega a `fs`.
 */
export async function readLocalImage(id: string): Promise<{ data: Buffer; mime: LandingImageMime } | null> {
  if (!isImageId(id)) return null;
  for (const [mime, extension] of Object.entries(IMAGE_EXTENSIONS)) {
    try {
      const data = await fs.readFile(path.join(IMAGES_DIR, `${id.toLowerCase()}.${extension}`));
      return { data, mime: mime as LandingImageMime };
    } catch {
      // prueba la siguiente extension
    }
  }
  return null;
}

async function removeLocalImageFile(image: LandingImage): Promise<void> {
  try {
    await fs.unlink(path.join(IMAGES_DIR, `${image.id}.${IMAGE_EXTENSIONS[image.mime]}`));
  } catch {
    // ya no estaba: nada que limpiar
  }
}

function emptyDb(): LocalDb {
  const ts = nowIso();
  return {
    version: 1,
    profiles: [],
    technologies: PRESET_TECHNOLOGIES.map((tech) => ({ ...tech, createdAt: ts, updatedAt: ts })),
    promptTemplates: PRESET_PROMPT_TEMPLATES.map((tpl) => ({ ...tpl, createdAt: ts, updatedAt: ts })),
    projects: [],
    prompts: [],
    promptVersions: [],
    generations: [],
    landingPages: [],
    landingVersions: [],
    reviews: [],
    landingImages: [],
    credentials: {},
  };
}

/** Cache a nivel de proceso: sobrevive al hot reload del servidor de desarrollo. */
const globalCache = globalThis as unknown as { __alsLocalDb?: Promise<LocalDb> };

async function loadDb(): Promise<LocalDb> {
  if (!globalCache.__alsLocalDb) {
    globalCache.__alsLocalDb = (async () => {
      try {
        const raw = await fs.readFile(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Partial<LocalDb>;
        const base = emptyDb();
        return {
          ...base,
          ...parsed,
          // El catalogo de presets siempre se refresca desde el codigo,
          // conservando lo que el usuario haya creado.
          technologies: mergePresets(base.technologies, parsed.technologies ?? []),
          promptTemplates: base.promptTemplates,
        } satisfies LocalDb;
      } catch {
        const fresh = emptyDb();
        await persist(fresh);
        return fresh;
      }
    })();
  }
  return globalCache.__alsLocalDb;
}

function mergePresets<T extends { id: string; ownerId?: string | null }>(presets: T[], stored: T[]): T[] {
  const userCreated = stored.filter((item) => item.ownerId != null);
  const presetIds = new Set(presets.map((p) => p.id));
  return [...presets, ...userCreated.filter((item) => !presetIds.has(item.id))];
}

let writeChain: Promise<void> = Promise.resolve();

async function persist(db: LocalDb): Promise<void> {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DB_DIR, { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  });
  await writeChain;
}

function matches(haystack: Array<string | null | undefined>, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((value) => (value ?? '').toLowerCase().includes(q));
}

function byNewest<T extends { createdAt: string }>(a: T, b: T): number {
  return b.createdAt.localeCompare(a.createdAt);
}

function assertOwner(ownerId: string, resourceOwnerId: string): void {
  if (ownerId !== resourceOwnerId) throw forbidden();
}

export class LocalDataStore implements DataStore {
  readonly mode = 'local' as const;

  /* ---------------------------------------------------------------- Perfil */

  async getProfile(userId: string): Promise<Profile | null> {
    const db = await loadDb();
    return db.profiles.find((p) => p.id === userId) ?? null;
  }

  async ensureProfile(userId: string, email: string, displayName: string): Promise<Profile> {
    const db = await loadDb();
    const existing = db.profiles.find((p) => p.id === userId);
    if (existing) return existing;

    const ts = nowIso();
    const profile: Profile = {
      id: userId,
      email,
      displayName,
      preferredProvider: 'mock',
      preferredModel: null,
      createdAt: ts,
      updatedAt: ts,
    };
    db.profiles.push(profile);
    await persist(db);
    return profile;
  }

  async updateProfile(
    userId: string,
    patch: Partial<Pick<Profile, 'displayName' | 'preferredProvider' | 'preferredModel'>>,
  ): Promise<Profile> {
    const db = await loadDb();
    const profile = db.profiles.find((p) => p.id === userId);
    if (!profile) throw notFound('tu perfil');
    Object.assign(profile, patch, { updatedAt: nowIso() });
    await persist(db);
    return profile;
  }

  async getCredentialsBlob(userId: string): Promise<string | null> {
    const db = await loadDb();
    return db.credentials?.[userId] ?? null;
  }

  async saveCredentialsBlob(userId: string, blob: string | null): Promise<void> {
    const db = await loadDb();
    const credentials = { ...(db.credentials ?? {}) };
    if (blob === null) delete credentials[userId];
    else credentials[userId] = blob;
    db.credentials = credentials;
    await persist(db);
  }

  /* ----------------------------------------------------------- Tecnologias */

  async listTechnologies(userId: string | null): Promise<Technology[]> {
    const db = await loadDb();
    return db.technologies
      .filter((tech) => tech.ownerId === null || tech.ownerId === userId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async getTechnologiesByIds(ids: string[]): Promise<Technology[]> {
    const db = await loadDb();
    const wanted = new Set(ids);
    return db.technologies
      .filter((tech) => wanted.has(tech.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async createTechnology(userId: string, input: NewTechnology): Promise<Technology> {
    const db = await loadDb();
    const ts = nowIso();
    const tech: Technology = {
      ...input,
      id: input.id ?? newId(),
      ownerId: userId,
      createdAt: ts,
      updatedAt: ts,
    };
    db.technologies.push(tech);
    await persist(db);
    return tech;
  }

  async updateTechnology(userId: string, id: string, patch: TechnologyPatch): Promise<Technology> {
    const db = await loadDb();
    const tech = db.technologies.find((t) => t.id === id);
    if (!tech) throw notFound('esa tecnologia');
    if (tech.ownerId === null) {
      throw forbidden();
    }
    assertOwner(userId, tech.ownerId);
    Object.assign(tech, patch, { updatedAt: nowIso() });
    await persist(db);
    return tech;
  }

  async deleteTechnology(userId: string, id: string): Promise<void> {
    const db = await loadDb();
    const tech = db.technologies.find((t) => t.id === id);
    if (!tech) throw notFound('esa tecnologia');
    if (tech.ownerId === null) throw forbidden();
    assertOwner(userId, tech.ownerId);
    db.technologies = db.technologies.filter((t) => t.id !== id);
    await persist(db);
  }

  /* ------------------------------------------------------------- Proyectos */

  async listProjects(userId: string, filter: ProjectFilter = {}): Promise<Project[]> {
    const db = await loadDb();
    let items = db.projects.filter((p) => p.ownerId === userId);
    if (filter.status) items = items.filter((p) => p.status === filter.status);
    if (filter.technologyId) {
      items = items.filter((p) => p.technical.technologyIds.includes(filter.technologyId as string));
    }
    if (filter.search) {
      items = items.filter((p) =>
        matches([p.basics.name, p.basics.theme, p.basics.description, p.basics.targetAudience], filter.search as string),
      );
    }
    items = items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return filter.limit ? items.slice(0, filter.limit) : items;
  }

  async getProject(userId: string, id: string): Promise<Project | null> {
    const db = await loadDb();
    const project = db.projects.find((p) => p.id === id);
    // Las lecturas de un recurso ajeno devuelven null (igual que con RLS en
    // Supabase): no se distingue "no existe" de "no es tuyo".
    if (!project || project.ownerId !== userId) return null;
    return project;
  }

  async createProject(userId: string, input: NewProject): Promise<Project> {
    const db = await loadDb();
    const ts = nowIso();
    const project: Project = { ...input, id: newId(), ownerId: userId, createdAt: ts, updatedAt: ts };
    db.projects.push(project);
    await persist(db);
    return project;
  }

  async updateProject(userId: string, id: string, patch: ProjectPatch): Promise<Project> {
    const db = await loadDb();
    const project = db.projects.find((p) => p.id === id);
    if (!project) throw notFound('ese proyecto');
    assertOwner(userId, project.ownerId);
    Object.assign(project, patch, { updatedAt: nowIso() });
    await persist(db);
    return project;
  }

  async deleteProject(userId: string, id: string): Promise<void> {
    const db = await loadDb();
    const project = db.projects.find((p) => p.id === id);
    if (!project) throw notFound('ese proyecto');
    assertOwner(userId, project.ownerId);
    db.projects = db.projects.filter((p) => p.id !== id);
    db.prompts = db.prompts.filter((p) => p.projectId !== id);
    db.landingPages = db.landingPages.filter((l) => l.projectId !== id);
    // En Supabase lo hace `on delete cascade`; aqui hay ademas ficheros que borrar.
    const orphanImages = db.landingImages.filter((image) => image.projectId === id);
    db.landingImages = db.landingImages.filter((image) => image.projectId !== id);
    await persist(db);
    await Promise.all(orphanImages.map(removeLocalImageFile));
  }

  /* --------------------------------------------------------------- Prompts */

  async listPrompts(userId: string, filter: PromptFilter = {}): Promise<Prompt[]> {
    const db = await loadDb();
    let items = db.prompts.filter((p) => p.ownerId === userId);
    if (filter.projectId) items = items.filter((p) => p.projectId === filter.projectId);
    if (filter.technologyId) items = items.filter((p) => p.technologyIds.includes(filter.technologyId as string));
    if (filter.tag) items = items.filter((p) => p.tags.includes(filter.tag as string));
    if (filter.search) items = items.filter((p) => matches([p.name, p.description], filter.search as string));
    items = items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return filter.limit ? items.slice(0, filter.limit) : items;
  }

  async getPrompt(userId: string, id: string): Promise<Prompt | null> {
    const db = await loadDb();
    const prompt = db.prompts.find((p) => p.id === id);
    if (!prompt || prompt.ownerId !== userId) return null;
    return prompt;
  }

  async createPrompt(userId: string, input: NewPrompt): Promise<Prompt> {
    const db = await loadDb();
    const ts = nowIso();
    const prompt: Prompt = {
      ...input,
      id: newId(),
      ownerId: userId,
      currentVersion: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    db.prompts.push(prompt);
    await persist(db);
    return prompt;
  }

  async updatePrompt(userId: string, id: string, patch: PromptPatch): Promise<Prompt> {
    const db = await loadDb();
    const prompt = db.prompts.find((p) => p.id === id);
    if (!prompt) throw notFound('ese prompt');
    assertOwner(userId, prompt.ownerId);
    Object.assign(prompt, patch, { updatedAt: nowIso() });
    await persist(db);
    return prompt;
  }

  async deletePrompt(userId: string, id: string): Promise<void> {
    const db = await loadDb();
    const prompt = db.prompts.find((p) => p.id === id);
    if (!prompt) throw notFound('ese prompt');
    assertOwner(userId, prompt.ownerId);
    db.prompts = db.prompts.filter((p) => p.id !== id);
    db.promptVersions = db.promptVersions.filter((v) => v.promptId !== id);
    await persist(db);
  }

  async listPromptVersions(userId: string, promptId: string): Promise<PromptVersion[]> {
    const db = await loadDb();
    return db.promptVersions
      .filter((v) => v.promptId === promptId && v.ownerId === userId)
      .sort((a, b) => b.version - a.version);
  }

  async getPromptVersion(userId: string, id: string): Promise<PromptVersion | null> {
    const db = await loadDb();
    const version = db.promptVersions.find((v) => v.id === id);
    if (!version || version.ownerId !== userId) return null;
    return version;
  }

  async createPromptVersion(userId: string, input: NewPromptVersion): Promise<PromptVersion> {
    const db = await loadDb();
    const prompt = db.prompts.find((p) => p.id === input.promptId);
    if (!prompt) throw notFound('el prompt asociado');
    assertOwner(userId, prompt.ownerId);

    const nextVersion = prompt.currentVersion + 1;
    const ts = nowIso();
    const version: PromptVersion = {
      ...input,
      id: newId(),
      ownerId: userId,
      version: nextVersion,
      createdAt: ts,
      updatedAt: ts,
    };
    db.promptVersions.push(version);
    prompt.currentVersion = nextVersion;
    prompt.updatedAt = ts;
    await persist(db);
    return version;
  }

  /* ------------------------------------------------------------ Plantillas */

  async listPromptTemplates(): Promise<PromptTemplate[]> {
    const db = await loadDb();
    return db.promptTemplates.filter((tpl) => tpl.isActive);
  }

  async getPromptTemplate(key: string): Promise<PromptTemplate | null> {
    const db = await loadDb();
    return db.promptTemplates.find((tpl) => tpl.key === key) ?? null;
  }

  /* ----------------------------------------------------------- Generaciones */

  async listGenerations(userId: string, filter: GenerationFilter = {}): Promise<Generation[]> {
    const db = await loadDb();
    let items = db.generations.filter((g) => g.ownerId === userId);
    if (filter.projectId) items = items.filter((g) => g.projectId === filter.projectId);
    if (filter.promptId) items = items.filter((g) => g.promptId === filter.promptId);
    items = items.sort(byNewest);
    return filter.limit ? items.slice(0, filter.limit) : items;
  }

  async getGeneration(userId: string, id: string): Promise<Generation | null> {
    const db = await loadDb();
    const generation = db.generations.find((g) => g.id === id);
    if (!generation || generation.ownerId !== userId) return null;
    return generation;
  }

  async createGeneration(userId: string, input: NewGeneration): Promise<Generation> {
    const db = await loadDb();
    const ts = nowIso();
    const generation: Generation = { ...input, id: newId(), ownerId: userId, createdAt: ts, updatedAt: ts };
    db.generations.push(generation);
    await persist(db);
    return generation;
  }

  async updateGeneration(userId: string, id: string, patch: GenerationPatch): Promise<Generation> {
    const db = await loadDb();
    const generation = db.generations.find((g) => g.id === id);
    if (!generation) throw notFound('esa generacion');
    assertOwner(userId, generation.ownerId);
    Object.assign(generation, patch, { updatedAt: nowIso() });
    await persist(db);
    return generation;
  }

  async findCachedGeneration(userId: string, cacheKey: string): Promise<Generation | null> {
    const db = await loadDb();
    return (
      db.generations
        .filter(
          (g) =>
            g.ownerId === userId &&
            g.cacheKey === cacheKey &&
            g.status === 'success' &&
            g.landingPageId !== null,
        )
        .sort(byNewest)[0] ?? null
    );
  }

  /* ---------------------------------------------------------- Landing pages */

  private filterLandings(items: LandingPage[], filter: LandingFilter): LandingPage[] {
    let result = items;
    if (filter.projectId) result = result.filter((l) => l.projectId === filter.projectId);
    if (filter.status) result = result.filter((l) => l.status === filter.status);
    if (filter.providerId) result = result.filter((l) => l.providerId === filter.providerId);
    if (filter.category) result = result.filter((l) => l.category === filter.category);
    if (filter.technologyId) {
      result = result.filter((l) => l.technologyIds.includes(filter.technologyId as string));
    }
    if (filter.search) {
      result = result.filter((l) => matches([l.name, l.description, l.category], filter.search as string));
    }
    result = result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return filter.limit ? result.slice(0, filter.limit) : result;
  }

  async listLandingPages(userId: string, filter: LandingFilter = {}): Promise<LandingPage[]> {
    const db = await loadDb();
    return this.filterLandings(
      db.landingPages.filter((l) => l.ownerId === userId),
      filter,
    );
  }

  async listPublicLandingPages(filter: LandingFilter = {}): Promise<LandingPage[]> {
    const db = await loadDb();
    return this.filterLandings(
      db.landingPages.filter((l) => l.status === 'public' || l.status === 'featured'),
      filter,
    );
  }

  async getLandingPage(userId: string | null, id: string): Promise<LandingPage | null> {
    const db = await loadDb();
    const landing = db.landingPages.find((l) => l.id === id);
    if (!landing) return null;
    const isPublic = landing.status === 'public' || landing.status === 'featured';
    if (!isPublic && landing.ownerId !== userId) return null;
    return landing;
  }

  async createLandingPage(userId: string, input: NewLandingPage): Promise<LandingPage> {
    const db = await loadDb();
    const ts = nowIso();
    const landing: LandingPage = {
      ...input,
      id: newId(),
      ownerId: userId,
      currentVersion: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    db.landingPages.push(landing);
    await persist(db);
    return landing;
  }

  async updateLandingPage(userId: string, id: string, patch: LandingPagePatch): Promise<LandingPage> {
    const db = await loadDb();
    const landing = db.landingPages.find((l) => l.id === id);
    if (!landing) throw notFound('esa Landing Page');
    assertOwner(userId, landing.ownerId);
    Object.assign(landing, patch, { updatedAt: nowIso() });
    await persist(db);
    return landing;
  }

  async deleteLandingPage(userId: string, id: string): Promise<void> {
    const db = await loadDb();
    const landing = db.landingPages.find((l) => l.id === id);
    if (!landing) throw notFound('esa Landing Page');
    assertOwner(userId, landing.ownerId);
    db.landingPages = db.landingPages.filter((l) => l.id !== id);
    db.landingVersions = db.landingVersions.filter((v) => v.landingPageId !== id);
    db.reviews = db.reviews.filter((r) => r.landingPageId !== id);
    await persist(db);
  }

  async listLandingVersions(userId: string, landingPageId: string): Promise<LandingVersion[]> {
    const db = await loadDb();
    return db.landingVersions
      .filter((v) => v.landingPageId === landingPageId && v.ownerId === userId)
      .sort((a, b) => b.version - a.version);
  }

  async createLandingVersion(userId: string, input: NewLandingVersion): Promise<LandingVersion> {
    const db = await loadDb();
    const landing = db.landingPages.find((l) => l.id === input.landingPageId);
    if (!landing) throw notFound('la Landing Page asociada');
    assertOwner(userId, landing.ownerId);

    const nextVersion =
      db.landingVersions
        .filter((v) => v.landingPageId === input.landingPageId)
        .reduce((max, v) => Math.max(max, v.version), 0) + 1;

    const ts = nowIso();
    const version: LandingVersion = {
      ...input,
      id: newId(),
      ownerId: userId,
      version: nextVersion,
      createdAt: ts,
      updatedAt: ts,
    };
    db.landingVersions.push(version);
    landing.currentVersion = nextVersion;
    landing.updatedAt = ts;
    await persist(db);
    return version;
  }

  /* --------------------------------------------------------------- Imagenes */

  async saveLandingImage(userId: string, input: NewLandingImage): Promise<LandingImage> {
    const db = await loadDb();
    const project = db.projects.find((p) => p.id === input.projectId);
    if (!project) throw notFound('ese proyecto');
    assertOwner(userId, project.ownerId);

    const { data, ...metadata } = input;
    const image: LandingImage = {
      ...metadata,
      id: newId(),
      ownerId: userId,
      bytes: data.byteLength,
      createdAt: nowIso(),
    };

    // Primero el fichero y despues la fila: una fila sin fichero seria una imagen rota.
    await fs.mkdir(IMAGES_DIR, { recursive: true });
    await fs.writeFile(path.join(IMAGES_DIR, `${image.id}.${IMAGE_EXTENSIONS[image.mime]}`), data);
    db.landingImages.push(image);
    await persist(db);
    return image;
  }

  /* ------------------------------------------------------------- Revisiones */

  async listReviews(userId: string, landingPageId: string): Promise<GenerationReview[]> {
    const db = await loadDb();
    return db.reviews
      .filter((r) => r.landingPageId === landingPageId && r.ownerId === userId)
      .sort(byNewest);
  }

  async getReview(userId: string, id: string): Promise<GenerationReview | null> {
    const db = await loadDb();
    const review = db.reviews.find((r) => r.id === id);
    if (!review || review.ownerId !== userId) return null;
    return review;
  }

  async createReview(userId: string, input: NewGenerationReview): Promise<GenerationReview> {
    const db = await loadDb();
    const ts = nowIso();
    const review: GenerationReview = { ...input, id: newId(), ownerId: userId, createdAt: ts, updatedAt: ts };
    db.reviews.push(review);
    await persist(db);
    return review;
  }

  /* -------------------------------------------------------------- Agregados */

  async getDashboardStats(userId: string): Promise<DashboardStats> {
    const db = await loadDb();
    const generations = db.generations.filter((g) => g.ownerId === userId);
    const successful = generations.filter((g) => g.status === 'success');
    const latencies = successful.filter((g) => g.latencyMs > 0).map((g) => g.latencyMs);

    return {
      projects: db.projects.filter((p) => p.ownerId === userId).length,
      landingPages: db.landingPages.filter((l) => l.ownerId === userId).length,
      prompts: db.prompts.filter((p) => p.ownerId === userId).length,
      generations: generations.length,
      successfulGenerations: successful.length,
      mockGenerations: generations.filter((g) => g.isMock).length,
      lastGenerationAt: generations.sort(byNewest)[0]?.createdAt ?? null,
      averageLatencyMs:
        latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    };
  }

  async search(userId: string, query: string): Promise<GlobalSearchResults> {
    const [projects, prompts, landingPages, technologies] = await Promise.all([
      this.listProjects(userId, { search: query, limit: 5 }),
      this.listPrompts(userId, { search: query, limit: 5 }),
      this.listLandingPages(userId, { search: query, limit: 5 }),
      this.listTechnologies(userId),
    ]);

    return {
      projects,
      prompts,
      landingPages,
      technologies: technologies.filter((t) => matches([t.name, t.description, t.slug], query)).slice(0, 5),
    };
  }
}
