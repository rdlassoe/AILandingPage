import 'server-only';

import type {
  Generation,
  GenerationReview,
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
 * Traduccion entre filas de PostgreSQL (snake_case) y el modelo de dominio
 * (camelCase). Aislar esta capa permite cambiar el esquema sin tocar los
 * servicios ni la UI.
 */

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nullableNum = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const json = <T>(v: unknown, fallback: T): T => (v && typeof v === 'object' ? (v as T) : fallback);

export const toProfile = (row: Row): Profile => ({
  id: str(row.id),
  email: str(row.email),
  displayName: str(row.display_name),
  preferredProvider: (str(row.preferred_provider, 'mock') as Profile['preferredProvider']) ?? 'mock',
  preferredModel: nullableStr(row.preferred_model),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const toTechnology = (row: Row): Technology => ({
  id: str(row.id),
  slug: str(row.slug),
  name: str(row.name),
  description: str(row.description),
  category: str(row.category, 'library') as Technology['category'],
  version: nullableStr(row.version),
  promptInstructions: str(row.prompt_instructions),
  constraints: arr(row.constraints),
  outputRequirements: arr(row.output_requirements),
  conflictsWith: arr(row.conflicts_with),
  priority: num(row.priority, 10),
  selfContainedPreview: bool(row.self_contained_preview, true),
  isActive: bool(row.is_active, true),
  sortOrder: num(row.sort_order, 100),
  ownerId: nullableStr(row.owner_id),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const fromTechnology = (tech: Partial<Technology>): Row => prune({
  id: tech.id,
  slug: tech.slug,
  name: tech.name,
  description: tech.description,
  category: tech.category,
  version: tech.version,
  prompt_instructions: tech.promptInstructions,
  constraints: tech.constraints,
  output_requirements: tech.outputRequirements,
  conflicts_with: tech.conflictsWith,
  priority: tech.priority,
  self_contained_preview: tech.selfContainedPreview,
  is_active: tech.isActive,
  sort_order: tech.sortOrder,
  owner_id: tech.ownerId,
});

export const toPromptTemplate = (row: Row): PromptTemplate => ({
  id: str(row.id),
  key: str(row.key),
  name: str(row.name),
  kind: str(row.kind, 'landing-generator') as PromptTemplate['kind'],
  description: str(row.description),
  template: str(row.template),
  variables: arr(row.variables),
  isActive: bool(row.is_active, true),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const toProject = (row: Row): Project => ({
  id: str(row.id),
  ownerId: str(row.owner_id),
  status: str(row.status, 'draft') as Project['status'],
  basics: json(row.basics, {} as Project['basics']),
  visual: json(row.visual, {} as Project['visual']),
  technical: json(row.technical, {} as Project['technical']),
  content: json(row.content, {} as Project['content']),
  negativeConstraints: arr(row.negative_constraints),
  discover: (row.discover as Project['discover']) ?? null,
  define: (row.define as Project['define']) ?? null,
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const fromProject = (project: Partial<Project>): Row => prune({
  id: project.id,
  owner_id: project.ownerId,
  status: project.status,
  basics: project.basics,
  visual: project.visual,
  technical: project.technical,
  content: project.content,
  negative_constraints: project.negativeConstraints,
  discover: project.discover,
  define: project.define,
});

export const toPrompt = (row: Row): Prompt => ({
  id: str(row.id),
  ownerId: str(row.owner_id),
  projectId: nullableStr(row.project_id),
  name: str(row.name),
  description: str(row.description),
  currentVersion: num(row.current_version),
  technologyIds: arr(row.technology_ids),
  tags: arr(row.tags),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const fromPrompt = (prompt: Partial<Prompt>): Row => prune({
  id: prompt.id,
  owner_id: prompt.ownerId,
  project_id: prompt.projectId,
  name: prompt.name,
  description: prompt.description,
  current_version: prompt.currentVersion,
  technology_ids: prompt.technologyIds,
  tags: prompt.tags,
});

export const toPromptVersion = (row: Row): PromptVersion => ({
  id: str(row.id),
  promptId: str(row.prompt_id),
  ownerId: str(row.owner_id),
  version: num(row.version),
  content: str(row.content),
  systemInstruction: str(row.system_instruction),
  sections: json(row.sections, [] as PromptVersion['sections']),
  technologyIds: arr(row.technology_ids),
  seedStringValue: nullableStr(row.seed_string_value),
  negativeConstraints: arr(row.negative_constraints),
  conflicts: json(row.conflicts, [] as PromptVersion['conflicts']),
  providerId: nullableStr(row.provider_id) as PromptVersion['providerId'],
  model: nullableStr(row.model),
  config: (row.config as PromptVersion['config']) ?? null,
  changeNote: str(row.change_note),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const fromPromptVersion = (version: Partial<PromptVersion>): Row => prune({
  id: version.id,
  prompt_id: version.promptId,
  owner_id: version.ownerId,
  version: version.version,
  content: version.content,
  system_instruction: version.systemInstruction,
  sections: version.sections,
  technology_ids: version.technologyIds,
  seed_string_value: version.seedStringValue,
  negative_constraints: version.negativeConstraints,
  conflicts: version.conflicts,
  provider_id: version.providerId,
  model: version.model,
  config: version.config,
  change_note: version.changeNote,
});

export const toGeneration = (row: Row): Generation => ({
  id: str(row.id),
  ownerId: str(row.owner_id),
  projectId: nullableStr(row.project_id),
  promptId: nullableStr(row.prompt_id),
  promptVersionId: nullableStr(row.prompt_version_id),
  kind: str(row.kind, 'landing') as Generation['kind'],
  providerId: str(row.provider_id, 'mock') as Generation['providerId'],
  model: str(row.model),
  status: str(row.status, 'pending') as Generation['status'],
  isMock: bool(row.is_mock),
  latencyMs: num(row.latency_ms),
  inputTokens: nullableNum(row.input_tokens),
  outputTokens: nullableNum(row.output_tokens),
  errorCode: nullableStr(row.error_code),
  errorMessage: nullableStr(row.error_message),
  warnings: arr(row.warnings),
  landingPageId: nullableStr(row.landing_page_id),
  config: (row.config as Generation['config']) ?? null,
  cacheKey: nullableStr(row.cache_key),
  servedFromCache: bool(row.served_from_cache),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const fromGeneration = (generation: Partial<Generation>): Row => prune({
  id: generation.id,
  owner_id: generation.ownerId,
  project_id: generation.projectId,
  prompt_id: generation.promptId,
  prompt_version_id: generation.promptVersionId,
  kind: generation.kind,
  provider_id: generation.providerId,
  model: generation.model,
  status: generation.status,
  is_mock: generation.isMock,
  latency_ms: generation.latencyMs,
  input_tokens: generation.inputTokens,
  output_tokens: generation.outputTokens,
  error_code: generation.errorCode,
  error_message: generation.errorMessage,
  warnings: generation.warnings,
  landing_page_id: generation.landingPageId,
  config: generation.config,
  cache_key: generation.cacheKey,
  served_from_cache: generation.servedFromCache,
});

export const toLandingPage = (row: Row): LandingPage => ({
  id: str(row.id),
  ownerId: str(row.owner_id),
  projectId: nullableStr(row.project_id),
  promptId: nullableStr(row.prompt_id),
  promptVersionId: nullableStr(row.prompt_version_id),
  generationId: nullableStr(row.generation_id),
  name: str(row.name),
  description: str(row.description),
  html: str(row.html),
  technologyIds: arr(row.technology_ids),
  providerId: str(row.provider_id, 'mock') as LandingPage['providerId'],
  model: str(row.model),
  isMock: bool(row.is_mock),
  status: str(row.status, 'draft') as LandingPage['status'],
  category: nullableStr(row.category),
  currentVersion: num(row.current_version, 1),
  metadata: json(row.metadata, {
    sections: [],
    seedStringValue: null,
    sizeBytes: 0,
    hasScript: false,
    hasStyle: false,
    criticScore: null,
  }),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const fromLandingPage = (landing: Partial<LandingPage>): Row => prune({
  id: landing.id,
  owner_id: landing.ownerId,
  project_id: landing.projectId,
  prompt_id: landing.promptId,
  prompt_version_id: landing.promptVersionId,
  generation_id: landing.generationId,
  name: landing.name,
  description: landing.description,
  html: landing.html,
  technology_ids: landing.technologyIds,
  provider_id: landing.providerId,
  model: landing.model,
  is_mock: landing.isMock,
  status: landing.status,
  category: landing.category,
  current_version: landing.currentVersion,
  metadata: landing.metadata,
});

export const toLandingVersion = (row: Row): LandingVersion => ({
  id: str(row.id),
  landingPageId: str(row.landing_page_id),
  ownerId: str(row.owner_id),
  version: num(row.version),
  html: str(row.html),
  label: str(row.label),
  generationId: nullableStr(row.generation_id),
  promptVersionId: nullableStr(row.prompt_version_id),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const fromLandingVersion = (version: Partial<LandingVersion>): Row => prune({
  id: version.id,
  landing_page_id: version.landingPageId,
  owner_id: version.ownerId,
  version: version.version,
  html: version.html,
  label: version.label,
  generation_id: version.generationId,
  prompt_version_id: version.promptVersionId,
});

export const toReview = (row: Row): GenerationReview => ({
  id: str(row.id),
  ownerId: str(row.owner_id),
  generationId: nullableStr(row.generation_id),
  landingPageId: str(row.landing_page_id),
  issues: json(row.issues, [] as GenerationReview['issues']),
  suggestions: json(row.suggestions, [] as GenerationReview['suggestions']),
  priority: arr(row.priority),
  scores: json(row.scores, {
    overall: 0,
    ux: 0,
    accessibility: 0,
    content: 0,
    code: 0,
    design: 0,
  }),
  refinementPrompt: str(row.refinement_prompt),
  providerId: str(row.provider_id, 'mock') as GenerationReview['providerId'],
  model: str(row.model),
  isMock: bool(row.is_mock),
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const fromReview = (review: Partial<GenerationReview>): Row => prune({
  id: review.id,
  owner_id: review.ownerId,
  generation_id: review.generationId,
  landing_page_id: review.landingPageId,
  issues: review.issues,
  suggestions: review.suggestions,
  priority: review.priority,
  scores: review.scores,
  refinement_prompt: review.refinementPrompt,
  provider_id: review.providerId,
  model: review.model,
  is_mock: review.isMock,
});

/** Elimina claves `undefined` para no sobrescribir columnas en un update parcial. */
function prune(row: Row): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
