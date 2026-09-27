import type { LLMModelInfo } from '@/types/llm';

/**
 * Catalogo de modelos por proveedor.
 *
 * Vive aparte de los adaptadores y sin dependencias de entorno para que lo
 * puedan importar tanto los proveedores (`server-only`) como el generador de
 * `supabase/seed.sql`, que corre fuera de Next.js. Asi la lista existe una
 * sola vez.
 *
 * El catalogo es INFORMATIVO: sirve para poblar los selectores y para acotar
 * `maxOutputTokens` cuando se conoce el limite. Un modelo que no aparezca aqui
 * sigue siendo utilizable; simplemente no se acota su salida y es la API del
 * proveedor la que valida.
 */

/**
 * Gemini. Verificado el 2026-09-23 llamando a `:generateContent` con cada
 * modelo, no solo listando `GET /v1beta/models`: la familia 2.5 sigue
 * apareciendo en el listado pero responde 404 "no longer available", asi que
 * el listado no basta como senal de disponibilidad.
 */
export const GEMINI_MODELS: LLMModelInfo[] = [
  {
    id: 'gemini-flash-latest',
    label: 'Gemini Flash (ultima estable)',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Alias que sigue al Flash estable mas reciente. No hay que mantenerlo a mano.',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Generacion mas reciente de la familia Flash.',
  },
  {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Version fijada, util si quieres resultados reproducibles.',
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Version fijada de la familia Flash.',
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Algo mas antiguo y por eso menos saturado. Buena alternativa cuando los nuevos dan 503.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Mas barato y rapido; consume menos cuota. Bien para criticas y para DISCOVER.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Opcion economica de la generacion anterior.',
  },
  {
    id: 'gemini-pro-latest',
    label: 'Gemini Pro (ultima estable)',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Mayor calidad de razonamiento y de diseno; mas lento y con mucha menos cuota gratuita.',
  },
];

/**
 * Groq. API compatible con OpenAI.
 *
 * Verificado el 2026-09-23 contra `/models` y con una llamada real a
 * `/chat/completions`: la familia Llama que ofrecia Groq hasta hace poco
 * (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`) responde ahora 404.
 */
export const GROQ_MODELS: LLMModelInfo[] = [
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'El mas capaz de Groq. Opcion recomendada para generar landings completas.',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    goodForLongOutput: true,
    description: 'Mismo limite de salida y mas rapido; menor calidad de diseno.',
  },
  {
    id: 'qwen/qwen3.8-27b',
    label: 'Qwen 3.8 27B',
    contextWindow: 131_042,
    maxOutputTokens: 16_384,
    goodForLongOutput: false,
    description: 'Muy rapido. Su limite de salida de 16K va justo para una landing larga.',
  },
];

/**
 * Ollama. A diferencia de Gemini y Groq, no existe un catalogo universal: los
 * modelos disponibles son los que cada maquina se haya descargado con
 * `ollama pull`. Esta lista es solo el punto de partida para el selector
 * cuando todavia no se ha consultado el servidor local; en cuanto Ollama esta
 * accesible, `OllamaProvider.listAvailableModels()` la sustituye por el
 * catalogo real via `GET /api/tags`.
 *
 * `qwen3:8b` y `qwen3:14b` se verificaron el 2026-09-23 contra una instancia
 * local real; el resto son nombres habituales de la biblioteca de Ollama
 * (https://ollama.com/library) que cada usuario debe descargar antes de
 * poder usarlos.
 */
export const OLLAMA_MODELS: LLMModelInfo[] = [
  {
    id: 'qwen3:8b',
    label: 'Qwen3 8B',
    contextWindow: 40_960,
    maxOutputTokens: 40_960,
    goodForLongOutput: true,
    description: 'Buen equilibrio entre calidad y velocidad en CPU/GPU domestica. Recomendado por defecto.',
  },
  {
    id: 'qwen3:14b',
    label: 'Qwen3 14B',
    contextWindow: 40_960,
    maxOutputTokens: 40_960,
    goodForLongOutput: true,
    description: 'Mas capaz que la version 8B; mas lento y exige mas memoria.',
  },
  {
    id: 'llama3.1',
    label: 'Llama 3.1 8B',
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    goodForLongOutput: true,
    description: 'Modelo generalista de Meta. Descargalo con `ollama pull llama3.1`.',
  },
  {
    id: 'mistral',
    label: 'Mistral 7B',
    contextWindow: 32_768,
    maxOutputTokens: 16_384,
    goodForLongOutput: false,
    description: 'Ligero y rapido; util cuando el equipo tiene poca VRAM.',
  },
  {
    id: 'deepseek-r1',
    label: 'DeepSeek R1',
    contextWindow: 64_000,
    maxOutputTokens: 32_768,
    goodForLongOutput: true,
    description: 'Modelo con razonamiento explicito. Igual que en Gemini, ese razonamiento consume presupuesto de salida.',
  },
];

export const MOCK_MODELS: LLMModelInfo[] = [
  {
    id: 'mock-studio-v1',
    label: 'Demo determinista',
    contextWindow: 1_000_000,
    maxOutputTokens: 100_000,
    goodForLongOutput: true,
    description:
      'Plantillas reales de la aplicacion: genera HTML autocontenido y auditorias basadas en analisis estatico.',
  },
];

/**
 * Limite de salida de un modelo, o `null` si no esta en el catalogo.
 *
 * Devolver `null` es intencionado: acotar un modelo desconocido a un valor
 * conservador truncaria silenciosamente la pagina generada. Es preferible
 * enviar lo que pide el usuario y dejar que el proveedor valide.
 */
export function maxOutputFor(models: readonly LLMModelInfo[], modelId: string): number | null {
  return models.find((model) => model.id === modelId)?.maxOutputTokens ?? null;
}
