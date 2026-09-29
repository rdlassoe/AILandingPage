import type { ProviderId, LLMGenerationConfig } from './llm';
import type { Timestamps } from './common';

/* -------------------------------------------------------------------------
 * Usuario
 * ---------------------------------------------------------------------- */

export interface Profile extends Timestamps {
  id: string;
  email: string;
  displayName: string;
  /** Proveedor preferido del usuario. */
  preferredProvider: ProviderId;
  preferredModel: string | null;
}

/* -------------------------------------------------------------------------
 * Tecnologias
 * ---------------------------------------------------------------------- */

export type TechnologyCategory =
  | 'language'
  | 'markup'
  | 'styling'
  | 'framework'
  | 'library'
  | 'tooling'
  | 'icons';

export interface Technology extends Timestamps {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: TechnologyCategory;
  version: string | null;
  /** Bloque que el Prompt Composer inyecta en la seccion TECHNOLOGY. */
  promptInstructions: string;
  /** Reglas duras ("no uses CDN", "un unico archivo"...). */
  constraints: string[];
  /** Que debe contener exactamente la salida para esta tecnologia. */
  outputRequirements: string[];
  /** Slugs incompatibles: alimenta la deteccion de conflictos. */
  conflictsWith: string[];
  /** Peso al resolver conflictos (mayor gana). */
  priority: number;
  /** Puede producir un documento HTML autocontenido para la preview. */
  selfContainedPreview: boolean;
  isActive: boolean;
  sortOrder: number;
  ownerId: string | null;
}

/* -------------------------------------------------------------------------
 * Seed Strings (SSoT)
 * ---------------------------------------------------------------------- */

/**
 * Familias de estilo internas del Mock Provider. No es un catalogo que el
 * usuario elija: el modo demo deriva una de estas 13 categorias hasheando el
 * string aleatorio de la Seed (suma de codigos + modulo), para variar su
 * salida sin depender de un LLM. Ver `src/lib/llm/mock/brief-parser.ts`.
 */
export type SeedCategory =
  | 'editorial'
  | 'bauhaus'
  | 'swiss'
  | 'brutalist'
  | 'industrial'
  | 'magazine'
  | 'retro-tech'
  | 'documentary'
  | 'architecture'
  | 'art'
  | 'luxury'
  | 'natural'
  | 'experimental';

/* -------------------------------------------------------------------------
 * Proyectos
 * ---------------------------------------------------------------------- */

export type ProjectStatus = 'draft' | 'defined' | 'generated' | 'archived';

export type LandingType =
  | 'saas'
  | 'product'
  | 'service'
  | 'event'
  | 'portfolio'
  | 'lead-generation'
  | 'app-mobile'
  | 'course'
  | 'ecommerce'
  | 'nonprofit'
  | 'other';

export type Tone =
  | 'directo'
  | 'tecnico'
  | 'cercano'
  | 'editorial'
  | 'institucional'
  | 'provocador'
  | 'sobrio';

export interface ProjectBasics {
  name: string;
  theme: string;
  description: string;
  landingType: LandingType;
  targetAudience: string;
  primaryGoal: string;
  productOrService: string;
  primaryCta: string;
}

export interface ProjectVisual {
  style: string;
  colors: string[];
  typography: string;
  /** 1 = funcional y austero, 5 = altamente refinado. */
  sophistication: number;
  references: string[];
  avoid: string[];
}

export interface ProjectTechnical {
  technologyIds: string[];
  framework: string | null;
  libraries: string[];
  constraints: string[];
}

export interface ProjectContent {
  sections: string[];
  features: string[];
  benefits: string[];
  keyMessage: string;
  tone: Tone;
}

/** Resultado de la fase DISCOVER. */
export interface DiscoverInsights {
  niche: string;
  audienceInsight: string;
  valueProposition: string;
  context: string;
  differentiators: string[];
  visualDirections: string[];
  /** 1-5. Cuanta publicidad ha visto ya este mercado. */
  marketSophistication: number;
  frictions: string[];
  generatedAt: string | null;
}

export interface SectionSpec {
  id: string;
  name: string;
  purpose: string;
  order: number;
  /** Contenido concreto que debe aparecer. */
  contentNotes: string;
  required: boolean;
}

/** Resultado de la fase DEFINE. */
export interface DefineSpec {
  informationArchitecture: SectionSpec[];
  visualHierarchy: string;
  ctaStrategy: string;
  copyStrategy: string;
  styleDirection: string;
  accessibilityCriteria: string[];
  responsiveCriteria: string[];
  definedAt: string | null;
}

export interface Project extends Timestamps {
  id: string;
  ownerId: string;
  status: ProjectStatus;
  basics: ProjectBasics;
  visual: ProjectVisual;
  technical: ProjectTechnical;
  content: ProjectContent;
  negativeConstraints: string[];
  discover: DiscoverInsights | null;
  define: DefineSpec | null;
}

/* -------------------------------------------------------------------------
 * Prompts
 * ---------------------------------------------------------------------- */

export type PromptTemplateKind =
  | 'landing-generator'
  | 'technology'
  | 'technology-combination'
  | 'ux-critic'
  | 'cro-critic'
  | 'accessibility-critic'
  | 'code-reviewer'
  | 'refinement'
  | 'variation'
  | 'discover';

export interface PromptTemplate extends Timestamps {
  id: string;
  key: string;
  name: string;
  kind: PromptTemplateKind;
  description: string;
  template: string;
  /** Nombres de variables que la plantilla espera. */
  variables: string[];
  isActive: boolean;
}

/** Secciones canonicas de un prompt ensamblado. */
export type PromptSectionId =
  | 'ROLE'
  | 'CONTEXT'
  | 'OBJECTIVE'
  | 'TARGET_AUDIENCE'
  | 'BUSINESS_GOAL'
  | 'VISUAL_DIRECTION'
  | 'SEED_STRING'
  | 'INFORMATION_ARCHITECTURE'
  | 'COPY_REQUIREMENTS'
  | 'TECHNOLOGY'
  | 'FUNCTIONAL_REQUIREMENTS'
  | 'RESPONSIVE_REQUIREMENTS'
  | 'ACCESSIBILITY'
  | 'SUBTRACTIVE_DESIGN'
  | 'NEGATIVE_CONSTRAINTS'
  | 'QUALITY_CRITERIA'
  | 'OUTPUT_FORMAT';

export interface PromptSection {
  id: PromptSectionId;
  title: string;
  body: string;
}

export interface PromptConflict {
  technologies: string[];
  reason: string;
  resolution: string;
}

export interface Prompt extends Timestamps {
  id: string;
  ownerId: string;
  projectId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  technologyIds: string[];
  tags: string[];
}

export interface PromptVersion extends Timestamps {
  id: string;
  promptId: string;
  ownerId: string;
  version: number;
  /** Texto final enviado al LLM. */
  content: string;
  /** Instruccion de sistema separada. */
  systemInstruction: string;
  sections: PromptSection[];
  technologyIds: string[];
  /** El string aleatorio de la Seed usado en esta version (tecnica SSoT). */
  seedStringValue: string | null;
  negativeConstraints: string[];
  conflicts: PromptConflict[];
  providerId: ProviderId | null;
  model: string | null;
  config: LLMGenerationConfig | null;
  /** Nota del usuario sobre que cambio en esta version. */
  changeNote: string;
}

/* -------------------------------------------------------------------------
 * Generaciones
 * ---------------------------------------------------------------------- */

export type GenerationStatus =
  | 'pending'
  | 'success'
  | 'invalid_output'
  | 'error'
  | 'timeout'
  | 'rate_limited'
  | 'cancelled';

export type GenerationKind =
  | 'landing'
  | 'refinement'
  | 'variation'
  | 'critique'
  | 'discover'
  | 'seed'
  | 'prompt_generation';

export interface Generation extends Timestamps {
  id: string;
  ownerId: string;
  projectId: string | null;
  promptId: string | null;
  promptVersionId: string | null;
  kind: GenerationKind;
  providerId: ProviderId;
  model: string;
  status: GenerationStatus;
  isMock: boolean;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Avisos del Output Validator (la generacion puede ser valida con avisos). */
  warnings: string[];
  landingPageId: string | null;
  config: LLMGenerationConfig | null;
  /** Hash del prompt + modelo + config, usado por la cache. */
  cacheKey: string | null;
  servedFromCache: boolean;
}

/* -------------------------------------------------------------------------
 * Landing Pages
 * ---------------------------------------------------------------------- */

export type LandingStatus = 'draft' | 'private' | 'public' | 'featured';

export interface LandingMetadata {
  sections: string[];
  seedStringValue: string | null;
  sizeBytes: number;
  hasScript: boolean;
  hasStyle: boolean;
  /** Puntuacion del Critic Engine (0-100) si ya fue evaluada. */
  criticScore: number | null;
}

export interface LandingPage extends Timestamps {
  id: string;
  ownerId: string;
  projectId: string | null;
  promptId: string | null;
  promptVersionId: string | null;
  generationId: string | null;
  name: string;
  description: string;
  /** Documento HTML autocontenido listo para `iframe.srcDoc`. */
  html: string;
  technologyIds: string[];
  providerId: ProviderId;
  model: string;
  isMock: boolean;
  status: LandingStatus;
  category: string | null;
  currentVersion: number;
  metadata: LandingMetadata;
}

export interface LandingVersion extends Timestamps {
  id: string;
  landingPageId: string;
  ownerId: string;
  version: number;
  html: string;
  label: string;
  generationId: string | null;
  promptVersionId: string | null;
}

/* -------------------------------------------------------------------------
 * Critic Engine
 * ---------------------------------------------------------------------- */

export type CriticDimension =
  | 'ux'
  | 'accessibility'
  | 'hierarchy'
  | 'responsive'
  | 'clarity'
  | 'visual-consistency'
  | 'cta'
  | 'content'
  | 'code'
  | 'subtractive'
  | 'generic-patterns';

export type CriticSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CriticIssue {
  id: string;
  dimension: CriticDimension;
  severity: CriticSeverity;
  title: string;
  description: string;
  /** Referencia al fragmento afectado (selector, seccion, linea...). */
  location: string | null;
}

export interface CriticSuggestion {
  id: string;
  issueId: string | null;
  dimension: CriticDimension;
  title: string;
  /** Cambio concreto propuesto. */
  action: string;
  impact: 'alto' | 'medio' | 'bajo';
}

export interface CriticScores {
  overall: number;
  ux: number;
  accessibility: number;
  content: number;
  code: number;
  design: number;
}

export interface GenerationReview extends Timestamps {
  id: string;
  ownerId: string;
  generationId: string | null;
  landingPageId: string;
  issues: CriticIssue[];
  suggestions: CriticSuggestion[];
  /** Ids de issues ordenados por prioridad de resolucion. */
  priority: string[];
  scores: CriticScores;
  /** Prompt listo para lanzar el refinamiento. */
  refinementPrompt: string;
  providerId: ProviderId;
  model: string;
  isMock: boolean;
}

/* -------------------------------------------------------------------------
 * Variantes
 * ---------------------------------------------------------------------- */

export type VariationStrategy =
  | 'same-structure-new-style'
  | 'same-brand-new-composition'
  | 'same-content-new-seed'
  | 'same-structure-new-cta'
  | 'minimal'
  | 'editorial'
  | 'experimental';

export const VARIATION_STRATEGIES: { id: VariationStrategy; label: string; description: string }[] = [
  {
    id: 'same-structure-new-style',
    label: 'Misma estructura, nuevo estilo',
    description: 'Conserva secciones y copy; cambia tipografia, color y tratamiento visual.',
  },
  {
    id: 'same-brand-new-composition',
    label: 'Misma marca, nueva composicion',
    description: 'Mantiene identidad y tono; reorganiza la maquetacion y el ritmo de la pagina.',
  },
  {
    id: 'same-content-new-seed',
    label: 'Mismo contenido, nueva Seed String',
    description: 'Aplica una direccion creativa distinta sobre la misma informacion.',
  },
  {
    id: 'same-structure-new-cta',
    label: 'Misma estructura, nuevo CTA',
    description: 'Reescribe la estrategia de conversion y el micro-copy de los botones.',
  },
  {
    id: 'minimal',
    label: 'Version minimalista',
    description: 'Aplica diseno sustractivo agresivo: menos secciones, menos elementos.',
  },
  {
    id: 'editorial',
    label: 'Version editorial',
    description: 'Tipografia protagonista, retícula editorial, lectura pausada.',
  },
  {
    id: 'experimental',
    label: 'Version experimental',
    description: 'Rompe la retícula convencional manteniendo usabilidad y accesibilidad.',
  },
];
