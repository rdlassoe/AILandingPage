import 'server-only';

import { postJson } from './http';
import { GROQ_MODELS, maxOutputFor } from './models';
import { env } from '@/lib/env';
import {
  DEFAULT_GENERATION_CONFIG,
  LLMError,
  type FinishReason,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type ProviderHealth,
} from '@/types/llm';

/** Forma parcial de la respuesta compatible con OpenAI que expone Groq. */
interface GroqResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class GroqProvider implements LLMProvider {
  readonly id = 'groq' as const;
  readonly label = 'Groq';
  readonly docsUrl = 'https://console.groq.com/keys';
  readonly envKey = 'GROQ_API_KEY';
  readonly models = GROQ_MODELS;

  get defaultModel(): string {
    return env.groq.defaultModel || 'openai/gpt-oss-120b';
  }

  isConfigured(): boolean {
    return env.groq.apiKey.length > 0;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new LLMError({
        code: 'not_configured',
        provider: this.id,
        message: 'Groq no tiene clave API configurada.',
        hint: 'Anade GROQ_API_KEY en .env.local y reinicia el servidor.',
      });
    }

    const model = request.model ?? this.defaultModel;
    const config = { ...DEFAULT_GENERATION_CONFIG, ...request.config };
    const started = Date.now();

    const limit = maxOutputFor(this.models, model);
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    // Groq rechaza con 400 un `response_format: json_object` si la palabra
    // "json" no aparece en los mensajes. Nuestras plantillas la incluyen, pero
    // el usuario puede editar el prompt en el Prompt Studio: se garantiza aqui
    // en lugar de depender de como este redactado el texto.
    if (request.responseFormat === 'json' && !mentionsJson(messages)) {
      messages.push({ role: 'system', content: 'Responde con un objeto JSON valido.' });
    }

    const data = await postJson<GroqResponse>({
      provider: this.id,
      url: `${env.groq.baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${env.groq.apiKey}` },
      body: {
        model,
        messages,
        temperature: config.temperature,
        top_p: config.topP,
        max_tokens: limit === null ? config.maxOutputTokens : Math.min(config.maxOutputTokens, limit),
        stream: false,
        ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      },
      timeoutMs: request.timeoutMs ?? env.llm.timeoutMs,
      signal: request.signal,
    });

    const choice = data.choices?.[0];
    const text = (choice?.message?.content ?? '').trim();

    if (!text) {
      throw new LLMError({
        code: 'invalid_response',
        provider: this.id,
        message: 'Groq devolvio una respuesta vacia.',
      });
    }

    return {
      text,
      provider: this.id,
      model,
      latencyMs: Date.now() - started,
      finishReason: normalizeFinishReason(choice?.finish_reason),
      isMock: false,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }

  async testConnection(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: this.id,
        status: 'not_configured',
        message: 'Falta GROQ_API_KEY en las variables de entorno.',
        checkedAt,
      };
    }

    const started = Date.now();
    try {
      const response = await this.generate({
        prompt: 'Responde unicamente con la palabra: ok',
        config: { maxOutputTokens: 512, temperature: 0 },
        timeoutMs: 15_000,
      });
      return {
        provider: this.id,
        status: 'connected',
        message: `Conexion correcta con ${response.model}.`,
        latencyMs: Date.now() - started,
        model: response.model,
        checkedAt,
      };
    } catch (error) {
      return {
        provider: this.id,
        status: 'error',
        message: error instanceof Error ? error.message : 'Error desconocido.',
        latencyMs: Date.now() - started,
        checkedAt,
      };
    }
  }

}

function mentionsJson(messages: Array<{ content: string }>): boolean {
  return messages.some((message) => message.content.toLowerCase().includes('json'));
}

function normalizeFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}
