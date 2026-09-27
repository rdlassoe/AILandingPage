import 'server-only';

import { parseBrief } from './mock/brief-parser';
import { buildMockCritique } from './mock/mock-critic';
import { MOCK_MODELS } from './models';
import {
  DEFAULT_MOCK_OPTIONS,
  generateMockLanding,
  type MockLandingOptions,
} from './mock/mock-landing-generator';
import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type ProviderHealth,
} from '@/types/llm';

/**
 * Mock Provider.
 *
 * Implementa la misma interfaz `LLMProvider` que Gemini y Groq, de modo que
 * el resto de la aplicacion no distingue entre uno y otro. Sirve para:
 *  - trabajar sin ninguna API de pago configurada;
 *  - desarrollar y probar el flujo completo de forma determinista;
 *  - degradar con elegancia cuando el proveedor elegido no esta disponible.
 *
 * IMPORTANTE: toda respuesta producida aqui viaja con `isMock: true` y la
 * aplicacion la etiqueta como "modo demo" en la interfaz, en la base de datos
 * y en los metadatos del HTML. Nunca se presenta como salida de Gemini o Groq.
 */

/** Latencia simulada para que los estados de carga se puedan probar de verdad. */
const SIMULATED_LATENCY_MS = 900;

export class MockProvider implements LLMProvider {
  readonly id = 'mock' as const;
  readonly label = 'Modo demo (sin IA)';
  readonly docsUrl = 'https://github.com/';
  readonly envKey = null;
  readonly models = MOCK_MODELS;
  readonly defaultModel = 'mock-studio-v1';

  isConfigured(): boolean {
    return true;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    await delay(SIMULATED_LATENCY_MS, request.signal);

    const text = this.route(request);

    return {
      text,
      provider: this.id,
      model: this.defaultModel,
      latencyMs: Date.now() - started,
      finishReason: 'stop',
      isMock: true,
      usage: {
        inputTokens: Math.ceil(request.prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
        totalTokens: Math.ceil((request.prompt.length + text.length) / 4),
      },
    };
  }

  async testConnection(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'connected',
      message: 'El modo demo siempre esta disponible. No consume cuota ni envia datos a ningun servicio.',
      latencyMs: 0,
      model: this.defaultModel,
      checkedAt: new Date().toISOString(),
    };
  }

  /** Decide que tipo de respuesta corresponde al prompt recibido. */
  private route(request: LLMRequest): string {
    const prompt = request.prompt;

    if (prompt.includes('"marketSophistication"')) {
      return this.discoverResponse(prompt);
    }

    if (prompt.includes('"refinementPrompt"') || prompt.includes('CODIGO A AUDITAR')) {
      const html = extractBetween(prompt, 'CODIGO A AUDITAR', null) ?? prompt;
      const requirements = extractBetween(prompt, 'REQUISITOS DEL PROYECTO', 'RESTRICCIONES QUE DEBIAN CUMPLIRSE') ?? '';
      const constraints = extractBetween(prompt, 'RESTRICCIONES QUE DEBIAN CUMPLIRSE', 'CODIGO A AUDITAR') ?? '';
      return buildMockCritique(html, requirements, constraints);
    }

    // Refinamiento y variacion: se reconstruye la pagina desde el encargo
    // original incrustado en el prompt, aplicando el mismo generador.
    const briefSource = extractBetween(prompt, 'ENCARGO ORIGINAL', 'VERSION ACTUAL') ?? prompt;
    const currentHtml = extractBetween(prompt, 'VERSION ACTUAL', 'ESTRATEGIA DE VARIACION')
      ?? extractBetween(prompt, 'VERSION ACTUAL', 'CAMBIOS QUE DEBES APLICAR')
      ?? '';

    return generateMockLanding(parseBrief(briefSource), resolveOptions(prompt, currentHtml));
  }

  private discoverResponse(prompt: string): string {
    const brief = parseBrief(prompt);
    return JSON.stringify(
      {
        niche: `${brief.theme} orientado a ${brief.audience}`,
        audienceInsight: `${capitalize(brief.audience)} no buscan una herramienta mas: buscan dejar de resolver a mano un problema que ya conocen. Evaluan rapido y abandonan si la pagina no explica que hace en los primeros diez segundos.`,
        valueProposition: brief.keyMessage || `${capitalize(brief.product)} resuelve ${brief.theme} sin obligar a cambiar de herramientas.`,
        context: `El objetivo declarado es ${brief.goal}. El publico llega comparando alternativas, no descubriendo la categoria.`,
        differentiators: [
          'Puesta en marcha sin proyecto de integracion',
          'Datos exportables en formatos abiertos',
          'Precio ligado al uso real',
          'Cada decision queda registrada y es reversible',
        ],
        visualDirections: [
          brief.style || 'Sobrio y tipografico, con la informacion por delante del adorno',
          'Editorial con retícula visible y jerarquia por tamano',
          'Instrumental: datos, etiquetas y densidad media',
        ],
        marketSophistication: 3,
        frictions: [
          'Dudas sobre el esfuerzo de migracion',
          'Miedo a quedar atrapado en un formato propietario',
          'Falta de claridad sobre el precio final',
          'No queda claro quien lo usa dentro del equipo',
        ],
      },
      null,
      2,
    );
  }
}

/**
 * Traduce las instrucciones de refinamiento a opciones del generador.
 *
 * Es lo que permite que el bucle GENERATE -> CRITIQUE -> REFINE mejore la
 * pagina de verdad en modo demo: si el usuario acepta la recomendacion de
 * anadir Open Graph, la version siguiente la incluye. Las mejoras que ya
 * estaban en la version actual se conservan para no regresar.
 */
function resolveOptions(prompt: string, currentHtml: string): MockLandingOptions {
  const asked = (pattern: RegExp): boolean => pattern.test(prompt);
  const present = (pattern: RegExp): boolean => pattern.test(currentHtml);

  return {
    ...DEFAULT_MOCK_OPTIONS,
    openGraph: present(/property=["']og:title["']/i) || asked(/open graph|og:title|twitter:card/i),
    structuredData:
      present(/application\/ld\+json/i) || asked(/json-ld|datos estructurados|schema\.org/i),
    formPrivacyNote:
      present(/class=["']form__note["']/i) ||
      asked(/micro-copy|privacidad|darse de baja|para que se usa el correo|que pasa con los datos/i),
    illustration:
      present(/class=["']hero__diagram["']/i) || asked(/diagrama|ilustracion|apoyo visual/i),
    favicon: present(/rel=["']icon["']/i) || asked(/favicon|theme-color/i),
  };
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function extractBetween(source: string, start: string, end: string | null): string | null {
  const startIndex = source.indexOf(start);
  if (startIndex === -1) return null;
  const from = startIndex + start.length;
  if (end === null) return source.slice(from).trim();
  const endIndex = source.indexOf(end, from);
  return (endIndex === -1 ? source.slice(from) : source.slice(from, endIndex)).trim();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('cancelled'));
      },
      { once: true },
    );
  });
}
