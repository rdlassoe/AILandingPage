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
  Technology,
  VariationStrategy,
} from './domain';
import type { EffectiveCredentials, LLMGenerationConfig, ProviderId } from './llm';

/* -------------------------------------------------------------------------
 * Prompt Engine
 * ---------------------------------------------------------------------- */

export interface PromptBuildInput {
  project: Project;
  technologies: Technology[];
  /**
   * El string aleatorio de la Seed (tecnica String Seed of Thought). Se
   * genera de nuevo en cada ejecucion — nunca se elige de un catalogo ni se
   * escribe a mano — y viaja tal cual a la seccion SEED STRING: es el propio
   * modelo (o, en modo demo, el hash deterministico de `brief-parser.ts`)
   * quien lo manipula para derivar una direccion creativa.
   *
   * Solo se usa si `designTechniques` incluye `seed-strings`: la Seed ES esa
   * tecnica, asi que sin elegirla no hay seccion SEED STRING aunque se pase
   * un string. Por eso puede omitirse (y conviene no generarlo, ahorra una
   * llamada al modelo).
   */
  randomSeedString?: string | null;
  negativeConstraints: string[];
  /** Tecnicas de diseno activadas por el usuario. */
  designTechniques: DesignTechniqueId[];
  discover?: DiscoverInsights | null;
  define?: DefineSpec | null;
}

/**
 * Las 8 tecnicas de "8 Tecnicas Avanzadas de Diseno de Landing Pages con IA".
 * Sustituyen a la lista anterior (ver docs/PROMPT_ENGINE.md).
 */
export type DesignTechniqueId =
  | 'seed-strings'
  | 'ambitious-prompts'
  | 'subagent-feedback'
  | 'image-generation'
  | 'video-generation'
  | 'subtractive-design'
  | 'negative-constraints-plus'
  | 'human-writing';

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
  /**
   * true solo cuando un LLM real reescribio este prompt (`composePromptViaLLM`
   * tuvo exito). false en modo demo (nunca hay LLM, es lo esperado) y
   * tambien false cuando SI habia un proveedor real pero la composicion fallo
   * (limite de cuota, timeout, formato invalido...) y se cayo al borrador
   * determinista como red de seguridad — ese segundo caso es el que la
   * interfaz debe avisar, porque de lo contrario es indistinguible de un
   * exito.
   */
  composedByLLM: boolean;
  /**
   * Por que se descarto la respuesta del LLM, cuando el motivo es nuestro y apto
   * para el usuario (omitio secciones, colo una tecnica no elegida, afirmo datos
   * que el encargo no aporta). No se rellena con errores del proveedor (cuota,
   * red): llevan datos de la cuenta y no sirven de nada al usuario.
   */
  fallbackReason?: string;
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
  /** Credenciales ya resueltas; si se omiten, el orquestador las resuelve por `ownerId`. */
  credentials?: EffectiveCredentials;
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
  /** Salta el enfriamiento entre peticiones: para una llamada que sigue, en la misma operacion, a otra ya limitada (ver `checkRateLimit`). La ventana por hora se sigue aplicando. */
  skipCooldown?: boolean;
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
  /**
   * Version del prompt ya compuesta y persistida (via `composeAndPersistPrompt`).
   * Si viene, se genera a partir de ella sin recomponer nada.
   */
  promptVersionId?: string;
  providerId?: ProviderId;
  model?: string;
  config?: Partial<LLMGenerationConfig>;
  /** Etiqueta de la version de landing resultante. */
  label?: string;
  allowCache?: boolean;
}

/** Entrada de `composeAndPersistPrompt`: compone el prompt final y lo persiste sin generar HTML. */
export interface ComposePromptInput {
  ownerId: string;
  projectId: string;
  promptId?: string;
  providerId?: ProviderId;
  model?: string;
  /** Tecnicas activas en el Prompt Studio; si falta, se usan las de `defaultEnabled: true`. */
  designTechniques?: DesignTechniqueId[];
}

export interface ComposePromptResult {
  built: BuiltPrompt;
  promptId: string;
  promptVersionId: string;
}

/**
 * Resultado del paso de imagenes (tecnica "Generacion de imagenes"): cuantos
 * marcadores `<img data-ai-image>` hay en la pagina y cuantos tienen ya una
 * imagen real. Los pendientes quedan como bloque neutro y se pueden reintentar.
 */
export interface ImageStepReport {
  /** Marcadores de imagen que hay en la pagina. */
  total: number;
  /** Con imagen real tras este paso: las que ya tenian mas las generadas ahora. */
  ready: number;
  /** Generadas en ESTE paso. */
  generated: number;
  /** Siguen como marcador pendiente. */
  pending: number;
  /** Por que quedaron pendientes (mensaje para el usuario); `null` si no hay ninguno. */
  reason: string | null;
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
  /** Presente solo si la pagina lleva marcadores de imagen (o el prompt los pedia). */
  images?: ImageStepReport;
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

/**
 * Resultado de generar el string aleatorio de la tecnica String Seed of
 * Thought (Misaki & Akiba, ICLR 2026). Deliberadamente NO incluye directrices
 * de diseno ya traducidas: eso era un paso intermedio que ya no existe —
 * quien reciba `randomString` (el Prompt Composer via LLM, o el hash
 * deterministico de Mock) es quien lo manipula para derivar una direccion
 * creativa, no este motor.
 */
export interface RandomSeedResult {
  randomString: string;
  /** true si se produjo con el PRNG del modo demo, no con un LLM real. */
  isMock: boolean;
}

export interface VariationInput {
  ownerId: string;
  landingPageId: string;
  strategy: VariationStrategy;
  notes?: string;
  providerId?: ProviderId;
  model?: string;
}
