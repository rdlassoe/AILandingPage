import 'server-only';

import { GeminiProvider } from './gemini-provider';
import { GroqProvider } from './groq-provider';
import { MockProvider } from './mock-provider';
import { OllamaProvider } from './ollama-provider';
import { env } from '@/lib/env';
import { PROVIDER_IDS, type LLMProvider, type ProviderId } from '@/types/llm';

/**
 * Registro de proveedores.
 *
 * Anadir OpenAI, Anthropic u OpenRouter consiste en:
 *   1. crear la clase que implemente `LLMProvider`;
 *   2. anadir su id a `ProviderId` en `src/types/llm.ts`;
 *   3. registrarla en este mapa.
 * Ningun otro archivo de la aplicacion necesita cambiar.
 */

const registry: Record<ProviderId, LLMProvider> = {
  mock: new MockProvider(),
  gemini: new GeminiProvider(),
  groq: new GroqProvider(),
  ollama: new OllamaProvider(),
};

export function getProvider(id: ProviderId): LLMProvider {
  return registry[id];
}

export function listProviders(): LLMProvider[] {
  return PROVIDER_IDS.map((id) => registry[id]);
}

/** Proveedor efectivo: el pedido, si esta configurado; si no, el modo demo. */
export function resolveProvider(requested?: ProviderId | null): {
  provider: LLMProvider;
  fellBackToMock: boolean;
  requested: ProviderId;
} {
  const wanted: ProviderId = requested ?? env.llm.defaultProvider;
  const provider = registry[wanted];

  if (provider.isConfigured()) {
    return { provider, fellBackToMock: false, requested: wanted };
  }

  return { provider: registry.mock, fellBackToMock: true, requested: wanted };
}

export interface ProviderSummary {
  id: ProviderId;
  label: string;
  docsUrl: string;
  envKey: string | null;
  configured: boolean;
  isDefault: boolean;
  defaultModel: string;
  models: { id: string; label: string; description?: string; goodForLongOutput: boolean }[];
}

/**
 * Resumen sin secretos, seguro para enviar al cliente.
 *
 * Es async porque algunos proveedores (Ollama) no tienen un catalogo fijo:
 * `listAvailableModels()` consulta el servidor real. Para el resto es
 * inmediato, ya que no implementan ese metodo opcional.
 */
export async function getProviderSummaries(): Promise<ProviderSummary[]> {
  return Promise.all(
    listProviders().map(async (provider) => {
      const models = (await provider.listAvailableModels?.()) ?? provider.models;
      return {
        id: provider.id,
        label: provider.label,
        docsUrl: provider.docsUrl,
        envKey: provider.envKey,
        configured: provider.isConfigured(),
        isDefault: provider.id === env.llm.defaultProvider,
        defaultModel: provider.defaultModel,
        models: models.map((model) => ({
          id: model.id,
          label: model.label,
          description: model.description,
          goodForLongOutput: model.goodForLongOutput,
        })),
      };
    }),
  );
}
