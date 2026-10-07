import 'server-only';

import { postJson } from './http';
import { GEMINI_MODELS, maxOutputFor } from './models';
import { env } from '@/lib/env';
import {
  DEFAULT_GENERATION_CONFIG,
  LLMError,
  type EffectiveCredentials,
  type FinishReason,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type ProviderHealth,
} from '@/types/llm';

/** Forma parcial de la respuesta de `generateContent`. */
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini' as const;
  readonly label = 'Google Gemini';
  readonly docsUrl = 'https://aistudio.google.com/apikey';
  readonly envKey = 'GEMINI_API_KEY';
  readonly models = GEMINI_MODELS;

  get defaultModel(): string {
    return env.gemini.defaultModel || 'gemini-flash-latest';
  }

  isConfigured(credentials: EffectiveCredentials): boolean {
    return credentials.geminiApiKey.length > 0;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured(request.credentials)) {
      throw new LLMError({
        code: 'not_configured',
        provider: this.id,
        message: 'Gemini no tiene clave API configurada.',
        hint: 'Pega tu clave en Ajustes (o define GEMINI_API_KEY en el servidor).',
      });
    }

    const model = request.model ?? this.defaultModel;
    const config = { ...DEFAULT_GENERATION_CONFIG, ...request.config };
    const started = Date.now();

    const limit = maxOutputFor(this.models, model);
    const payload: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: {
        temperature: config.temperature,
        topP: config.topP,
        maxOutputTokens: limit === null ? config.maxOutputTokens : Math.min(config.maxOutputTokens, limit),
        ...(request.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
      },
    };

    if (request.system) {
      payload.systemInstruction = { parts: [{ text: request.system }] };
    }

    const data = await postJson<GeminiResponse>({
      provider: this.id,
      url: `${env.gemini.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': request.credentials.geminiApiKey },
      body: payload,
      timeoutMs: request.timeoutMs ?? env.llm.timeoutMs,
      signal: request.signal,
    });

    if (data.promptFeedback?.blockReason) {
      throw new LLMError({
        code: 'content_filter',
        provider: this.id,
        message: `Gemini bloqueo la peticion (${data.promptFeedback.blockReason}).`,
      });
    }

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      // Los modelos con razonamiento gastan parte del presupuesto de salida en
      // pensar. Si se agota antes de escribir nada, la respuesta llega vacia
      // con finishReason MAX_TOKENS y un 200: no es un fallo de la clave.
      const exhausted = candidate?.finishReason === 'MAX_TOKENS';
      throw new LLMError({
        code: 'invalid_response',
        provider: this.id,
        message: exhausted
          ? `${model} agoto el presupuesto de salida razonando y no llego a escribir la respuesta.`
          : 'Gemini devolvio una respuesta vacia.',
        hint: exhausted ? 'Sube maxOutputTokens o elige un modelo con mayor limite de salida.' : undefined,
      });
    }

    return {
      text,
      provider: this.id,
      model,
      latencyMs: Date.now() - started,
      finishReason: normalizeFinishReason(candidate?.finishReason),
      isMock: false,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
    };
  }

  async testConnection(credentials: EffectiveCredentials): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured(credentials)) {
      return {
        provider: this.id,
        status: 'not_configured',
        message: 'Falta la clave de Gemini: pegala en Ajustes o define GEMINI_API_KEY en el servidor.',
        checkedAt,
      };
    }

    const started = Date.now();
    try {
      const response = await this.generate({
        credentials,
        prompt: 'Responde unicamente con la palabra: ok',
        // 512 y no 16: los modelos con razonamiento consumen parte del
        // presupuesto pensando, y con un tope minusculo la respuesta llega
        // vacia aunque la clave sea correcta.
        config: { maxOutputTokens: 512, temperature: 0 },
        timeoutMs: 20_000,
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

function normalizeFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter';
    case undefined:
      return 'unknown';
    default:
      return 'unknown';
  }
}
