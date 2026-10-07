# Capa de proveedores LLM

## Interfaz común

Todo el sistema habla con los modelos a través de una única interfaz
(`src/types/llm.ts`). Ningún componente de React ni ningún servicio importa el SDK de un
proveedor.

```ts
interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly docsUrl: string;
  readonly envKey: string | null;      // variable que lo habilita
  readonly models: readonly LLMModelInfo[];
  readonly defaultModel: string;

  isConfigured(credentials: EffectiveCredentials): boolean;
  generate(request: LLMRequest): Promise<LLMResponse>;      // request.credentials: las del usuario
  testConnection(credentials: EffectiveCredentials): Promise<ProviderHealth>;
  listAvailableModels?(credentials: EffectiveCredentials): Promise<LLMModelInfo[]>;  // catalogo dinamico (Ollama)
}
```

`EffectiveCredentials` son las claves **de quien hace la petición**: las que guardó en Ajustes y,
para lo que no tenga, las del entorno (`src/lib/credentials`). El orquestador las resuelve por
`ownerId`, así que dos usuarios pueden hablar con el mismo proveedor con claves distintas, y un
proveedor «configurado» para uno puede no estarlo para otro. Ver
[`ENVIRONMENT.md`](ENVIRONMENT.md#claves-guardadas-desde-ajustes).

```
        servicios
            │
            ▼
   LLMOrchestrator          ← proveedor, modelo, timeout, límite, reintento
            │
            ▼
       LLMProvider          ← interfaz común
       ┌────┬────────┬──────────┐
       ▼    ▼        ▼          ▼
  MockProvider  Gemini   Groq   Ollama
```

El catálogo de modelos vive aparte, en [`src/lib/llm/models.ts`](../src/lib/llm/models.ts),
sin dependencias de entorno. Así lo importan tanto los adaptadores (que son `server-only`)
como el generador de `supabase/seed.sql`, que corre fuera de Next.js: **la lista existe una
sola vez**.

---

## Cómo se verifica un catálogo

> Listar modelos **no basta** para saber cuáles funcionan.

Es la lección más cara de esta integración. Al conectar las claves reales apareció esto:

| Proveedor | En el listado | Realidad al llamar |
| --- | --- | --- |
| Gemini | `gemini-2.5-flash`, `-flash-lite`, `-pro` aparecen en `GET /v1beta/models` | `404 no longer available` |
| Groq | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` ya no aparecen | `404 does not exist` |

Ambas familias estaban en el catálogo escrito de memoria. Por eso el catálogo actual se
verificó **llamando a `:generateContent` / `/chat/completions` con cada modelo**, uno por uno.
Si añades uno nuevo, haz lo mismo antes de fiarte del listado.

Un modelo que **no** esté en el catálogo sigue siendo utilizable: simplemente no se acota su
`maxOutputTokens` y es la API del proveedor quien valida. Eso es deliberado — ver
[Presupuesto de salida](#presupuesto-de-salida).

---

## Proveedores incluidos

### Modo demo (`mock`)

Siempre disponible. No consume cuota ni envía datos a ningún servicio.

- **Landing Pages.** Un generador determinista produce un documento HTML autocontenido,
  semántico, responsive y accesible. Tiene 13 familias de estilo (suizo, Bauhaus, brutalista,
  industrial, retro, lujo, editorial…), pero **hoy solo salen dos**: la familia se elige buscando
  palabras clave en el string aleatorio de la Seed y, con un string aleatorio, el 83 % de las veces
  es «editorial» y el 17 % «retro-tech» (ver la decisión 9 de [`ARCHITECTURE.md`](ARCHITECTURE.md)).
  El JavaScript embebido funciona de verdad: menú móvil, acordeón de preguntas y validación de
  formulario. Con la técnica «Generación de imágenes» deja un marcador `<img data-ai-image>` en el
  hero, que rellena el servidor con una imagen real: el HTML sigue etiquetado como demo.
- **Auditorías.** Ejecuta comprobaciones estáticas reales sobre el HTML —`lang`, viewport,
  `alt`, jerarquía de encabezados, estilos de foco, etiquetas de formulario, media queries,
  Open Graph, JSON-LD, clichés de IA, exceso de degradados o de secciones— y construye el
  informe con lo que encuentra. No inventa problemas.
- **Refinamiento.** Interpreta las recomendaciones aceptadas y aplica las que puede aplicar
  de forma determinista, de modo que la segunda auditoría mejora de verdad.

> Toda respuesta del modo demo lleva `isMock: true`. La interfaz la etiqueta como **demo**,
> se guarda así en `generations.is_mock` y queda registrado en
> `<meta name="generator">` del HTML. Nunca se presenta como salida de Gemini o Groq.

### Google Gemini (`gemini`)

Variable: `GEMINI_API_KEY` (o pégala en **Ajustes**) — clave gratuita en <https://aistudio.google.com/apikey>.
Modelo por defecto: `GEMINI_DEFAULT_MODEL`, recomendado `gemini-flash-latest`.

| Modelo | Contexto | Salida máx. | Nota |
| --- | --- | --- | --- |
| `gemini-flash-latest` | 1 048 576 | 65 536 | Alias al Flash estable vigente. **Recomendado.** |
| `gemini-3.8-flash` | 1 048 576 | 65 536 | Generación más reciente. |
| `gemini-3.7-flash` | 1 048 576 | 65 536 | Versión fijada. |
| `gemini-3.6-flash` | 1 048 576 | 65 536 | Versión fijada. |
| `gemini-3.5-flash` | 1 048 576 | 65 536 | Más antiguo, menos saturado. |
| `gemini-3.5-flash-lite` | 1 048 576 | 65 536 | Económico. Bien para DISCOVER y críticas. |
| `gemini-3.1-flash-lite` | 1 048 576 | 65 536 | Económico. |
| `gemini-pro-latest` | 1 048 576 | 65 536 | Mejor razonamiento; mucha menos cuota. |

Endpoint `:generateContent`; la instrucción de sistema viaja en `systemInstruction` y el
modo JSON usa `responseMimeType: application/json`.

**Usa los alias `-latest`.** Los modelos fijados se retiran: la familia 2.5 entera dejó de
responder. Un alias no requiere mantenimiento.

#### Tokens de razonamiento

Los modelos Gemini 3.x razonan antes de escribir, y **ese razonamiento consume el mismo
presupuesto de salida**. Medido sobre `gemini-3.6-flash` con el prompt «responde solo: ok»:

| `maxOutputTokens` | Tokens de razonamiento | Texto devuelto | `finishReason` |
| --- | --- | --- | --- |
| 16 | 12 | *(vacío)* | `MAX_TOKENS` |
| 256 | 98 | `ok` | `STOP` |
| 2048 | 96 | `ok` | `STOP` |
| 64 + `thinkingBudget: 0` | 0 | `ok` | `STOP` |

Consecuencia práctica: **un presupuesto pequeño devuelve 200 OK con texto vacío**, que es
indistinguible de un fallo si no se mira `finishReason`. Por eso:

- `testConnection()` pide 512 tokens, no 16. Con 16 daba «Error» teniendo la clave válida.
- El adaptador distingue el caso y responde *«el modelo agotó el presupuesto de salida
  razonando»* con la pista de subir `maxOutputTokens`, en lugar de un genérico «respuesta
  vacía».

### Groq (`groq`)

Variable: `GROQ_API_KEY` (o pégala en **Ajustes**) — clave gratuita en <https://console.groq.com/keys>.
Modelo por defecto: `GROQ_DEFAULT_MODEL`, recomendado `openai/gpt-oss-120b`.

| Modelo | Contexto | Salida máx. | Nota |
| --- | --- | --- | --- |
| `openai/gpt-oss-120b` | 131 072 | 65 536 | El más capaz. **Recomendado.** |
| `openai/gpt-oss-20b` | 131 072 | 65 536 | Más rápido, menor calidad de diseño. |
| `qwen/qwen3.8-27b` | 131 042 | 16 384 | Muy rápido; 16K va justo para una landing larga. |

API compatible con OpenAI (`/chat/completions`).

#### Límite de 8 000 tokens **por petición**

La capa gratuita de Groq no solo limita el ritmo: rechaza con **413** cualquier petición
individual que supere 8 000 tokens, y eso no se arregla esperando.

```
HTTP 413: Request too large … on tokens per minute (TPM): Limit 8000, Requested 10325
```

Afecta a los pasos que envían el HTML completo junto al encargo. Por eso el refinamiento y
las variantes incrustan solo las siete secciones vinculantes del encargo original
(`CONTEXT`, `TARGET_AUDIENCE`, `BUSINESS_GOAL`, `VISUAL_DIRECTION`, `SEED_STRING`,
`COPY_REQUIREMENTS`, `NEGATIVE_CONSTRAINTS`) en lugar de las 17: pasa de ~10 300 a ~6 000
tokens. El resto ya está encarnado en el HTML que se envía.

Aun así, **auditar una página de más de ~20 KB no cabe en 8 000 tokens**. La aplicación lo
comunica como `too_large` con el mensaje «reintentar no servirá: hay que acortarla», no
como un error transitorio. Para páginas grandes, audita con Gemini y genera con Groq.

#### El modo JSON exige la palabra «json»

Groq rechaza con **400** un `response_format: { type: 'json_object' }` si la palabra `json`
no aparece en ningún mensaje:

```
'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'
```

Las plantillas del Critic Engine y de DISCOVER ya la incluyen, pero el usuario puede editar
el prompt en el Prompt Studio. El adaptador lo garantiza: si pide JSON y ningún mensaje
menciona la palabra, añade una instrucción corta de sistema.

### Ollama (`ollama`)

Sin variable de entorno obligatoria: corre en local, igual que el modo demo. `OLLAMA_BASE_URL`
es opcional (por defecto `http://localhost:11434`) y, **solo en modo local**, también se puede
cambiar desde **Ajustes** (en un despliegue compartido sería una puerta de SSRF, así que ahí solo
vale la variable); `OLLAMA_DEFAULT_MODEL` fija el modelo preseleccionado (por defecto `qwen3:8b`).

Requiere tener [Ollama](https://ollama.com/download) instalado y en ejecución, y haber
descargado al menos un modelo:

```bash
ollama pull qwen3:8b
```

El adaptador habla con el endpoint compatible con OpenAI que expone Ollama
(`POST /v1/chat/completions`), así que reutiliza el mismo `postJson` que Groq. La diferencia
real frente a Gemini/Groq:

- **No hay clave ni cuota.** `isConfigured()` devuelve siempre `true`: no hay credencial que
  pedir. La disponibilidad real —si Ollama está arrancado— se ve al pulsar «Probar conexión»
  en Ajustes, igual que con cualquier otro proveedor.
- **El catálogo no es fijo.** A diferencia de Gemini/Groq, los modelos disponibles dependen de
  qué se haya descargado en esa máquina. `src/lib/llm/models.ts` solo trae una lista de
  referencia; en cuanto Ollama responde, `OllamaProvider.listAvailableModels()` la sustituye
  por el catálogo real vía `GET /api/tags`. Si Ollama no está accesible, se usa la lista de
  referencia sin romper la pantalla.
- **Sin límite de tokens por petición** como el 413 de Groq: el límite real es la memoria de la
  máquina y la ventana de contexto del modelo instalado.
- **El fallo más común es la conexión, no la autenticación.** Si Ollama no está arrancado, el
  adaptador traduce el error de red a un mensaje explícito («No se pudo contactar con Ollama en
  http://localhost:11434») con la pista de comprobar que está en ejecución y que el modelo se
  descargó con `ollama pull`.

**Rendimiento.** Un modelo local en CPU puede tardar bastante más que los 20-72 s medidos con
Gemini/Groq en la nube. Si los timeouts son frecuentes, sube `LLM_TIMEOUT_MS` en `.env.local`.

#### Modelos "thinking" gastan el presupuesto de salida razonando

Igual que Gemini 3.x, los modelos con razonamiento explícito de Ollama (la familia `qwen3`,
entre otros) devuelven un campo `reasoning` además de `content`, y **ambos consumen el mismo
`max_tokens`**. Verificado el 2026-09-23 contra `qwen3:8b` en local, con el prompt «responde
solo: ok»:

| `max_tokens` | Tokens de razonamiento | Texto devuelto | `finish_reason` |
| --- | --- | --- | --- |
| 20 | 20 | *(vacío)* | `length` |
| 256 | ~200 | `ok` | `stop` |
| 512 | ~200 | `ok` | `stop` |

Igual que en Gemini, un presupuesto pequeño devuelve **200 OK con texto vacío**, indistinguible
de un fallo si no se mira `finish_reason`. Por eso `testConnection()` pide 512 tokens, no un
valor menor, y el adaptador distingue el caso (`content` vacío + `finish_reason: "length"` +
`reasoning` presente) para responder *«el modelo agotó el presupuesto de salida razonando»* en
vez de un genérico «respuesta vacía».

**Solo para desarrollo local o una instancia remota accesible por red.** En un despliegue
serverless (Vercel, Netlify) `http://localhost:11434` no es alcanzable: usa `OLLAMA_BASE_URL`
apuntando a un servidor Ollama con red hacia la función, o no ofrezcas este proveedor en
producción.

---

## Generación de imágenes (Cloudflare Workers AI)

La técnica de diseño «Generación de imágenes» genera imágenes **de verdad** con FLUX.1 schnell en
Cloudflare Workers AI (capa gratuita) y las añade a la página. **No es un `LLMProvider`** y no se
añadió a `ProviderId`: es un enum de Postgres (`provider_id`) que usan unos 28 ficheros y los
selectores de proveedor, y Cloudflare no compite con Gemini o Groq —solo rellena los marcadores que
deja el LLM—. Reutiliza el transporte de `postJson` (`src/lib/llm/http.ts`, con `provider` ampliado a
`ErrorSource = ProviderId | 'cloudflare'`) y vive aparte: cliente en
[`src/lib/images/cloudflare.ts`](../src/lib/images/cloudflare.ts), orquestación en
[`src/services/image-generator`](../src/services/image-generator/index.ts). Cómo encaja en el flujo,
qué se guarda y por qué la vista previa incrusta las imágenes: decisión 12 de
[`ARCHITECTURE.md`](ARCHITECTURE.md).

### La API

```
POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell
Authorization: Bearer {TOKEN}
{ "prompt": "…" (1-2048 caracteres), "steps": 4 (máx. 8) }
→ { "success": true, "result": { "image": "<base64>" }, "errors": [], "messages": [] }
```

Account ID y token (variables de entorno o **Ajustes**, por usuario y cifrados). Token con permisos
*Workers AI – Read* y *Edit* (guía:
<https://developers.cloudflare.com/workers-ai/get-started/rest-api/>). schnell **no tiene
`width`/`height` ni prompt negativo**: la salida es de tamaño fijo y por eso el prompt lleva siempre el
sufijo `, no text, no letters, no logos, no watermark`, y la técnica pide al LLM contenedores con
`aspect-ratio` y `object-fit: cover`.

**Cloudflare no documenta el formato ni la resolución de salida; medidos contra la API real
(2026-09-30):** `image/jpeg` de **1024×1024**, de 486 a 545 KB, en ~1,9 s a 4 pasos (5,7 s la
primera llamada, a 1 paso). Aun así nada se da por bueno: el cliente detecta PNG/JPEG/WebP por los
primeros bytes (`src/lib/images/sniff.ts`), sirve la imagen con ese tipo —nunca con el que diga el
proveedor— y rechaza lo que no lo sea o pase de 5 MB. `npm run verify:cloudflare` lo vuelve a medir
(2 imágenes, unas decenas de neuronas).

### Errores

El cliente hace **un intento**; los reintentos y la política de cuota viven en el servicio.

| Código propio | Cuándo | Reintento |
| --- | --- | --- |
| `quota` | HTTP 429 con código `3036` (el documentado) o `4006` (el que devuelve hoy la API). | No. Abre el freno de cuota. |
| `busy` | HTTP 429 con otro código, p. ej. `3040` (capacidad temporal). | Sí, una vez (2,5 s). |
| `server` | 5xx. | Sí, una vez (3 s). |
| `timeout` / `network` | Sin respuesta a tiempo / sin conexión. | Sí, una vez (1 s). |
| `auth` | 401/403 (`5018`, `5035`…). | No. |
| `invalid_request` | 400/422. | No. |
| `invalid_image` | 200 sin imagen, base64 roto, formato no admitido o demasiado grande. | No. |
| `not_configured` / `cancelled` | Faltan credenciales / se canceló. | No. |

### Cuota y frenos

- Capa gratuita: **10 000 neuronas al día** (reinicio 00:00 UTC) y 720 peticiones por minuto. Al
  agotarla, las operaciones fallan con 429. Coste de schnell según la página de precios: 4,8
  neuronas por tesela de 512×512 más 9,6 por paso. Como la salida es de 1024×1024 (4 teselas), a 4
  pasos son **~57,6 neuronas por imagen → ~173 imágenes al día** (~43 páginas de 4). Estimación de
  los precios publicados, aún sin contrastar con el panel de Cloudflare.
- **Riesgo conocido de la plataforma:** hay reportes de 429/`4006` que **persisten después del
  reinicio de las 00:00 UTC con el panel de Cloudflare en 0/10 000**. Por eso el freno de cuota
  (`src/lib/images/limits.ts`) dura `IMAGE_QUOTA_COOLDOWN_MS` (10 min) y los mensajes nunca prometen
  «se reinicia a medianoche».
- Cuatro limitadores en memoria de proceso, con su propio cubo (no gastan el límite de llamadas al
  LLM ni al revés): **freno de cuota** (global: la cuota es de la cuenta de Cloudflare, no de un
  usuario), **freno de almacenamiento**, **imágenes por usuario y hora**
  (`IMAGE_RATE_LIMIT_PER_HOUR`) y **plazo del paso** (`IMAGE_STEP_BUDGET_MS`, acotado por el
  `maxDuration` de 120 s de la ruta). Con varias instancias harían falta Redis o una tabla.
- **Freno de almacenamiento.** Si una imagen se genera pero **no se puede guardar** (en Supabase:
  falta la tabla `landing_images` o el bucket `landing-images` porque no se ejecutó `npm run
  db:setup`, o hay un problema de políticas), cada intento posterior gastaría ~58 neuronas para tirar
  la imagen. Al primer fallo se abre un freno de `IMAGE_STORAGE_COOLDOWN_MS` (60 s): no se vuelve a
  llamar a Cloudflare y el aviso dice **qué** falta (`describeStorageError` reconoce bucket, tabla y
  políticas) en lugar de un genérico «no se pudo guardar». Lo que ya estaba en vuelo (hasta 2
  imágenes) sí se gasta. Es corto a propósito: en cuanto se arregla el almacén, el siguiente intento
  debe poder salir bien.

### Probar sin gastar cuota

`scripts/stub-cloudflare.mjs` imita la API (éxito, cuota, saturación, 5xx, credenciales, respuesta que no es imagen, PNG enorme, lentitud, «falla dos veces»). Se elige el
comportamiento con una palabra clave en el prompt (`__quota__`, `__busy_once__`…, ver la cabecera del
script). Es lo que usan `npm run verify:images` y `npm run verify:images-flow`; la app lo usa con
`CLOUDFLARE_API_BASE_URL=http://localhost:8788`. Ver [`DEVELOPMENT.md`](DEVELOPMENT.md).

---

## Normalización

Los proveedores no responden igual, así que cada adaptador traduce su respuesta a
`LLMResponse` (texto, modelo, uso de tokens, latencia, motivo de finalización, `isMock`) y
sus fallos a `LLMError`, con códigos comunes:

| Código | Cuándo | Reintenta |
| --- | --- | --- |
| `not_configured` | Falta la clave. | No |
| `auth` | 401 / 403. | No |
| `rate_limited` | 429. | No — reintentar dentro de la misma ventana no ayuda. |
| `timeout` | Se agotó el tiempo. | Sí |
| `network` | No se pudo contactar. | Sí |
| `server` | 5xx. | Sí |
| `invalid_response` | Respuesta vacía o ilegible. | No |
| `content_filter` | Bloqueada por el proveedor. | No |
| `cancelled` | Cancelada por el usuario. | No |

`toAppError` convierte cada código en un mensaje para el usuario final y una pista
accionable. El detalle técnico se queda en el servidor.

### 503 y 429 no significan lo mismo

Los dos son frecuentes en las capas gratuitas y conviene distinguirlos:

| Código | Significado | Qué hace la app |
| --- | --- | --- |
| **503** | *Ese modelo* está saturado. Muy común en los recién salidos. No es un fallo del servicio. | Un reintento tras 5 s, y el mensaje sugiere cambiar de modelo. |
| **429** | Cuota agotada para ese modelo. | Sin reintento. Si el proveedor envía `retry-after`, el mensaje dice cuántos segundos esperar. |

---

## Presupuesto de salida

`DEFAULT_GENERATION_CONFIG.maxOutputTokens` es **32 768**. Una Landing Page completa ronda
los 6–8 K tokens, pero los modelos con razonamiento gastan además parte del presupuesto
pensando; con 16 K la página se truncaba.

El adaptador acota a `min(config, límite del modelo)` **solo si conoce el modelo**. Para uno
desconocido envía lo pedido sin acotar: acotarlo a un valor conservador truncaría la página
en silencio, que es el peor fallo posible porque parece un éxito.

---

## Degradación elegante

Si se pide un proveedor sin clave configurada **para ese usuario** (ni guardada en Ajustes ni
en el entorno), `resolveProvider` devuelve el modo demo y marca `fellBackToMock`. La aplicación **no falla**: genera, lo etiqueta como demo y avisa
en la interfaz con un enlace a Ajustes.

---

## Límites y coste

`LLMOrchestrator` aplica antes de cualquier llamada de red:

- ventana deslizante de `RATE_LIMIT_MAX_REQUESTS` peticiones por `RATE_LIMIT_WINDOW_MS`;
- enfriamiento de `RATE_LIMIT_COOLDOWN_MS` entre peticiones;
- timeout de `LLM_TIMEOUT_MS` con `AbortController`;
- **un único** reintento ante fallos transitorios, con espera proporcional: 5 s para un 5xx
  (un modelo saturado no se recupera en un segundo) y 1,5 s para red o timeout.

El limitador existe para proteger la cuota de los proveedores externos, así que el modo
demo y Ollama están exentos —ninguno de los dos consume cuota de un tercero—: de lo contrario
el enfriamiento bloquearía pasos encadenados del flujo (generar y auditar seguidos) sin
ninguna ganancia.

### El enfriamiento entre pasos internos de una misma acción

Algunas acciones del usuario disparan **más de una** llamada real seguida: "Generar prompt"
genera primero la Seed y luego compone con ella (ver
[`ARCHITECTURE.md`](ARCHITECTURE.md#10-componer-el-prompt-es-un-paso-explícito-no-un-efecto-colateral-de-generar)),
y una variante con "nueva Seed" hace lo mismo antes de generar. Esas dos llamadas quedan a
menudo a 1-2 segundos una de otra — menos que `RATE_LIMIT_COOLDOWN_MS` (3 s por defecto) —
así que la segunda se bloqueaba casi siempre, y `buildPromptForProject` caía al borrador
determinista **sin avisar**, indistinguible de un éxito.

`checkRateLimit(userId, { skipCooldown })` resuelve esto: la llamada que **inicia** la acción
respeta el enfriamiento con normalidad (frente a la acción anterior del usuario), pero la
llamada que la **continúa**, en la misma operación, lo salta — aunque sigue contando para la
ventana por hora, que protege la cuota total, no el ritmo entre pasos. Se aplica en
`composePromptViaLLM` (cuando la Seed está elegida, sigue a `generateRandomSeedString`; sin
ella es la llamada que inicia la acción y respeta el enfriamiento), en el camino de
`generateLanding` que compone y genera en una sola llamada, y en `generateVariation` cuando
la estrategia pide una Seed nueva.

Si la composición falla igualmente —por ejemplo por el límite real de tokens por minuto de
Groq, no por este enfriamiento—, el `BuiltPrompt` resultante lleva `composedByLLM: false` y
el Prompt Studio lo avisa en pantalla en vez de mostrar el borrador como si fuera un éxito
silencioso.

### Consumo real medido

| Fase | Entrada | Salida | Latencia |
| --- | --- | --- | --- |
| DISCOVER | ~415 | ~450–560 | 5–35 s |
| Generación de landing | ~3 450 | 1 800–12 150 | 21–72 s |
| Crítica | ~2 250–12 600 | ~870–1 170 | 10–88 s |
| Refinamiento | ~5 500 | ~2 230 | 8 s |
| Variante | ~5 800–15 700 | 1 840–13 150 | 61–65 s |

Dos consecuencias:

- **Gemini**: tres generaciones seguidas con un Flash agotaron la cuota gratuita diaria de
  ese modelo. Reparte el trabajo: un `-lite` para DISCOVER y críticas, un Flash completo
  solo para generar.
- **Groq**: la capa gratuita limita a **8 000 tokens por minuto**. Una generación consume
  ~7 400, así que auditar inmediatamente después da 429. Hay que espaciar los pasos
  aproximadamente un minuto.

`LLM_TIMEOUT_MS` vale 90 s por defecto. Con 72 s medidos en una generación, no lo bajes.

---

## Añadir un proveedor

Tres pasos, sin tocar el núcleo:

**1. Añade su catálogo** a `src/lib/llm/models.ts`, verificando cada modelo con una llamada
real.

**2. Implementa la interfaz** en un fichero nuevo (aquí `src/lib/llm/openai-provider.ts`, que es
solo el ejemplo y **no existe**):

```ts
export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI';
  readonly docsUrl = 'https://platform.openai.com/api-keys';
  readonly envKey = 'OPENAI_API_KEY';
  readonly models = OPENAI_MODELS;
  get defaultModel() { return env.openai.defaultModel; }

  isConfigured(credentials: EffectiveCredentials) { return credentials.openaiApiKey.length > 0; }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const limit = maxOutputFor(this.models, model);
    const data = await postJson<OpenAIResponse>({ /* … */ });
    return { text, provider: this.id, model, latencyMs, usage, finishReason, isMock: false };
  }

  async testConnection(credentials: EffectiveCredentials): Promise<ProviderHealth> { /* … */ }
}
```

Usa `postJson` de `src/lib/llm/http.ts`: ya aplica timeout, cancelación y traducción de
errores HTTP a `LLMError`.

**3. Registra el id** en `ProviderId` y `PROVIDER_IDS` (`src/types/llm.ts`), la clase en
`src/lib/llm/registry.ts` y la lectura de la variable en `src/lib/env.ts`.

**4. Si necesita clave, hazla editable desde Ajustes:** añade el campo (`openaiApiKey`) a
`EffectiveCredentials` (`src/types/llm.ts`), a `envCredentials()` (`src/lib/env.ts`), a
`CREDENTIAL_FIELDS`, `LABELS` y `merge` (`src/lib/credentials/index.ts`) y a `saveCredentialsSchema`
(`src/lib/validation/schemas.ts`), y una casilla en `PROVIDER_FIELDS` de
`src/features/settings/provider-settings.tsx`. `npm run verify:credentials` comprueba que se usa
la clave del usuario y no la del entorno.

El selector del Prompt Studio, el esquema de validación del proveedor y el catálogo de la base de
datos se actualizan solos. Regenera el SQL con `npm run seed:sql`.

Para un proveedor local sin clave, `src/lib/llm/ollama-provider.ts` es el ejemplo real:
`baseUrl` apunta a `http://localhost:11434` por defecto y `envKey` es `null`, igual que hace
el modo demo. Si además el catálogo de modelos varía por máquina (no se puede fijar de
antemano), implementa el método opcional `listAvailableModels()` de `LLMProvider` para
consultarlo en caliente en vez de depender solo del catálogo estático.

---

## Verificar la integración

```bash
npm run dev                                          # terminal 1
npm run verify:flow -- --provider=gemini             # terminal 2
npm run verify:flow -- --provider=groq                # pausa 65 s entre pasos
npm run verify:flow -- --provider=gemini --model=gemini-3.5-flash
npm run verify:flow -- --provider=ollama --model=qwen3:8b
```

Recorre el flujo completo contra el proveedor real y comprueba, entre otras cosas, que la
generación queda **atribuida al proveedor y no al modo demo**. Detalle en
[`DEVELOPMENT.md`](DEVELOPMENT.md).

---

## Seguridad

- Las claves del servidor se leen solo en `src/lib/env.ts`, marcado como `server-only`: si un
  componente de cliente lo importa, el build falla. Las que cada usuario guarda en Ajustes se
  resuelven en `src/lib/credentials` (también `server-only`).
- Las llamadas salen exclusivamente desde route handlers.
- `/api/providers` devuelve un resumen sin secretos: solo si cada proveedor está
  configurado, su modelo por defecto y su catálogo de modelos.
- `/api/providers/test` hace una petición real mínima y devuelve estado, mensaje y latencia.
  Nunca la clave.
- Las claves del servidor no se guardan en la base de datos ni aparecen en los registros. Las
  que el usuario escribe en Ajustes **sí** se guardan, pero cifradas (AES-256-GCM) y por usuario:
  en la base de datos solo hay texto cifrado, la clave maestra está fuera de ella y nunca vuelven
  al navegador. Comprobado también sobre el bundle compilado: ninguna clave del servidor aparece
  en `.next/static`.
- La URL de Ollama solo se acepta desde Ajustes en modo local (en modo compartido sería una
  puerta de SSRF); las de Gemini, Groq y Cloudflare están fijas en el código.
