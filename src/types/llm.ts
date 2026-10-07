/**
 * Contratos de la LLM Provider Layer.
 *
 * Ningun componente de React ni ninguna pagina debe importar SDKs de
 * proveedores concretos: todo pasa por `LLMProvider` y por el
 * `LLMOrchestrator`.
 */

export type ProviderId = 'mock' | 'gemini' | 'groq' | 'ollama';

export const PROVIDER_IDS: readonly ProviderId[] = ['mock', 'gemini', 'groq', 'ollama'] as const;

export type ProviderStatus = 'connected' | 'not_configured' | 'error';

export interface LLMModelInfo {
  id: string;
  label: string;
  /** Ventana de contexto aproximada, en tokens. */
  contextWindow: number;
  /** Tokens de salida maximos soportados. */
  maxOutputTokens: number;
  /** Adecuado para generar documentos HTML largos. */
  goodForLongOutput: boolean;
  description?: string;
}

export interface LLMGenerationConfig {
  temperature: number;
  maxOutputTokens: number;
  topP: number;
}

export const DEFAULT_GENERATION_CONFIG: LLMGenerationConfig = {
  temperature: 0.8,
  // Una Landing Page completa ronda los 6-8K tokens, pero los modelos con
  // razonamiento gastan ademas parte del presupuesto pensando antes de
  // escribir. Con 16K la pagina se truncaba; 32K deja margen para ambos.
  maxOutputTokens: 32768,
  topP: 0.95,
};

/**
 * Credenciales con las que se habla con los proveedores EN ESTA PETICION: las que el
 * usuario guardo en Ajustes y, para lo que no tenga, las de las variables de entorno
 * (`src/lib/credentials`). Son secretos: solo existen en el servidor, nunca viajan al
 * cliente ni se registran. Cadena vacia = sin configurar.
 */
export interface EffectiveCredentials {
  geminiApiKey: string;
  groqApiKey: string;
  /** URL base del servidor de Ollama (no es secreta, pero es configuracion del usuario). */
  ollamaBaseUrl: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
}

export interface LLMRequest {
  /** Credenciales efectivas del usuario que hace la peticion. */
  credentials: EffectiveCredentials;
  /** Instruccion de sistema / rol. */
  system?: string;
  /** Prompt de usuario ya ensamblado por el Prompt Engine. */
  prompt: string;
  model?: string;
  config?: Partial<LLMGenerationConfig>;
  /** Pide al proveedor que responda JSON cuando lo soporta de forma nativa. */
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error' | 'unknown';

export interface LLMResponse {
  text: string;
  provider: ProviderId;
  model: string;
  usage: LLMUsage;
  latencyMs: number;
  finishReason: FinishReason;
  /** true cuando la respuesta NO proviene de un modelo real. */
  isMock: boolean;
}

export interface ProviderHealth {
  provider: ProviderId;
  status: ProviderStatus;
  message: string;
  latencyMs?: number;
  model?: string;
  checkedAt: string;
}

/**
 * Interfaz comun. Anadir un proveedor nuevo (OpenAI, Anthropic, Ollama,
 * OpenRouter...) consiste unicamente en implementar esta interfaz y
 * registrarla en `src/lib/llm/registry.ts`.
 */
export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly docsUrl: string;
  /** Nombre de la variable de entorno que habilita el proveedor. */
  readonly envKey: string | null;
  readonly models: readonly LLMModelInfo[];
  readonly defaultModel: string;
  isConfigured(credentials: EffectiveCredentials): boolean;
  generate(request: LLMRequest): Promise<LLMResponse>;
  testConnection(credentials: EffectiveCredentials): Promise<ProviderHealth>;
  /**
   * Solo para proveedores cuyo catalogo no se puede fijar de antemano (p.ej.
   * Ollama: depende de que modelos haya descargado cada maquina). Si no se
   * implementa, la aplicacion usa `models` como catalogo estatico.
   */
  listAvailableModels?(credentials: EffectiveCredentials): Promise<LLMModelInfo[]>;
}

export type LLMErrorCode =
  | 'not_configured'
  | 'too_large'
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'invalid_response'
  | 'cancelled'
  | 'content_filter'
  | 'unknown';

/**
 * Origen de un error HTTP: un proveedor de texto o el de imagenes. Cloudflare
 * NO es un `ProviderId` (es un enum de Postgres y alimenta los selectores de
 * proveedor): solo reutiliza el transporte de `postJson`.
 */
export type ErrorSource = ProviderId | 'cloudflare';

/** Error normalizado: todos los adaptadores traducen sus fallos a esta clase. */
export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly provider: ErrorSource;
  readonly status?: number;
  readonly retryable: boolean;
  readonly hint?: string;

  constructor(params: {
    code: LLMErrorCode;
    provider: ErrorSource;
    message: string;
    status?: number;
    retryable?: boolean;
    hint?: string;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = 'LLMError';
    this.code = params.code;
    this.provider = params.provider;
    this.status = params.status;
    this.retryable = params.retryable ?? ['rate_limited', 'timeout', 'network', 'server'].includes(params.code);
    this.hint = params.hint;
  }
}
