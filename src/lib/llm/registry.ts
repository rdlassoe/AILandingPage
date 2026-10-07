import 'server-only';

import { GeminiProvider } from './gemini-provider';
import { GroqProvider } from './groq-provider';
import { MockProvider } from './mock-provider';
import { OllamaProvider } from './ollama-provider';
import { env } from '@/lib/env';
import { PROVIDER_IDS, type EffectiveCredentials, type LLMProvider, type ProviderId } from '@/types/llm';

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

/**
 * Proveedor efectivo: el pedido, si esta configurado CON LAS CREDENCIALES DE ESTE USUARIO
 * (las de Ajustes y, si faltan, las del entorno); si no, el modo demo.
 */
export function resolveProvider(
  requested: ProviderId | null | undefined,
  credentials: EffectiveCredentials,
): {
  provider: LLMProvider;
  fellBackToMock: boolean;
  requested: ProviderId;
} {
  const wanted: ProviderId = requested ?? env.llm.defaultProvider;
  const provider = registry[wanted];

  if (provider.isConfigured(credentials)) {
    return { provider, fellBackToMock: false, requested: wanted };
  }

  return { provider: registry.mock, fellBackToMock: true, requested: wanted };
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
}

/**
 * Resumen minimo y siempre sincrono (sin `listAvailableModels()`, que para
 * Ollama consulta la red): pensado para el layout, que se evalua en cada
 * pagina del area privada y no puede pagar esa latencia solo para pintar el
 * indicador de proveedor de la barra lateral.
 */
export function listProviderStatuses(credentials: EffectiveCredentials): ProviderStatus[] {
  return listProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(credentials),
  }));
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
export async function getProviderSummaries(credentials: EffectiveCredentials): Promise<ProviderSummary[]> {
  return Promise.all(
    listProviders().map(async (provider) => {
      const models = (await provider.listAvailableModels?.(credentials)) ?? provider.models;
      return {
        id: provider.id,
        label: provider.label,
        docsUrl: provider.docsUrl,
        envKey: provider.envKey,
        configured: provider.isConfigured(credentials),
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
