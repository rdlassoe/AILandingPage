import type {
  CriticIssue,
  CriticScores,
  CriticSuggestion,
  DefineSpec,
  DiscoverInsights,
  LandingPage,
  Project,
  PromptConflict,
  PromptSection,
  SeedDirectives,
  SeedString,
  Technology,
  VariationStrategy,
} from './domain';
import type { LLMGenerationConfig, ProviderId } from './llm';

/* -------------------------------------------------------------------------
 * Prompt Engine
 * ---------------------------------------------------------------------- */

export interface PromptBuildInput {
  project: Project;
  technologies: Technology[];
  seed: SeedString | null;
  /** Seed escrita a mano que sobrescribe la seleccionada. */
  customSeedValue?: string | null;
  negativeConstraints: string[];
  /** Tecnicas de diseno activadas por el usuario. */
  designTechniques: DesignTechniqueId[];
  discover?: DiscoverInsights | null;
  define?: DefineSpec | null;
}

export type DesignTechniqueId =
  | 'subtractive-design'
  | 'human-copywriting'
  | 'visual-hierarchy'
  | 'progressive-disclosure'
  | 'social-proof-discipline'
  | 'seed-anchoring'
  | 'micro-copy'
  | 'performance-budget';

export interface DesignTechnique {
  id: DesignTechniqueId;
  label: string;
  summary: string;
  /** Bloque inyectado en el prompt cuando la tecnica esta activa. */
  instruction: string;
  defaultEnabled: boolean;
}

export interface BuiltPrompt {
  systemInstruction: string;
  content: string;
  sections: PromptSection[];
  conflicts: PromptConflict[];
  technologyIds: string[];
  seedStringValue: string | null;
  negativeConstraints: string[];
  /** Estimacion aproximada de tokens para avisar antes de enviar. */
  estimatedTokens: number;
}

/* -------------------------------------------------------------------------
 * Output Validator
 * ---------------------------------------------------------------------- */

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidatedOutput {
  valid: boolean;
  /** HTML normalizado y listo para `iframe.srcDoc`. */
  html: string;
  title: string;
  description: string;
  sections: string[];
  sizeBytes: number;
  hasScript: boolean;
  hasStyle: boolean;
  issues: ValidationIssue[];
  /** true si hubo que extraer el HTML de una respuesta conversacional. */
  normalized: boolean;
}

/* -------------------------------------------------------------------------
 * LLM Orchestrator
 * ---------------------------------------------------------------------- */

export interface OrchestratorRequest {
  ownerId: string;
  system?: string;
  prompt: string;
  providerId?: ProviderId;
  model?: string;
  config?: Partial<LLMGenerationConfig>;
  responseFormat?: 'text' | 'json';
  /** Reutiliza una respuesta previa identica si existe. */
  allowCache?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OrchestratorResult {
  text: string;
  providerId: ProviderId;
  model: string;
  latencyMs: number;
  isMock: boolean;
  servedFromCache: boolean;
  cacheKey: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/* -------------------------------------------------------------------------
 * Landing Generator
 * ---------------------------------------------------------------------- */

export interface GenerateLandingInput {
  ownerId: string;
  projectId: string;
  /** Prompt editado a mano en el Prompt Studio; si falta se reconstruye. */
  promptContent?: string;
  systemInstruction?: string;
  promptId?: string;
  providerId?: ProviderId;
  model?: string;
  config?: Partial<LLMGenerationConfig>;
  /** Etiqueta de la version de landing resultante. */
  label?: string;
  allowCache?: boolean;
}

export interface GenerateLandingResult {
  landingPage: LandingPage;
  generationId: string;
  promptVersionId: string;
  validation: ValidatedOutput;
  isMock: boolean;
  providerId: ProviderId;
  model: string;
  latencyMs: number;
  servedFromCache: boolean;
}

/* -------------------------------------------------------------------------
 * Critic Engine
 * ---------------------------------------------------------------------- */

export interface CritiqueInput {
  ownerId: string;
  landingPageId: string;
  providerId?: ProviderId;
  model?: string;
}

export interface CritiqueOutput {
  issues: CriticIssue[];
  suggestions: CriticSuggestion[];
  priority: string[];
  scores: CriticScores;
  refinementPrompt: string;
}

export interface RefineInput {
  ownerId: string;
  landingPageId: string;
  reviewId?: string;
  /** Ids de sugerencias que el usuario acepta aplicar. */
  acceptedSuggestionIds: string[];
  /** Instrucciones adicionales escritas por el usuario. */
  extraInstructions?: string;
  providerId?: ProviderId;
  model?: string;
}

/* -------------------------------------------------------------------------
 * Seed Engine
 * ---------------------------------------------------------------------- */

export interface SeedResolution {
  value: string;
  directives: SeedDirectives;
  source: 'preset' | 'custom' | 'generated' | 'none';
}

export interface VariationInput {
  ownerId: string;
  landingPageId: string;
  strategy: VariationStrategy;
  notes?: string;
  providerId?: ProviderId;
  model?: string;
}
