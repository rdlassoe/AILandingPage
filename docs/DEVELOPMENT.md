# Desarrollo

## Puesta en marcha

```bash
npm install
npm run dev          # http://localhost:3000
```

Sin configuración: almacén local en `./.data` y modo demo. Entra con cualquier correo.

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (flat config)
npm run build        # build de producción
npm run db:setup     # crea el esquema en Supabase (necesita SUPABASE_DB_URL)
npm run db:check     # diagnostica el estado de la base, sin escribir
npm run seed:sql     # regenera supabase/seed.sql desde el catálogo
npm run verify:flow  # recorrido de aceptación contra el servidor de desarrollo
npm run verify:inspector  # instrumentación del inspector y mensajes del iframe (sin servidor)
npm run verify:prompt     # el prompt lleva solo las técnicas elegidas, con y sin LLM (sin servidor ni claves)
npm run verify:images     # marcadores, cliente de Cloudflare, pipeline y env, contra el stub (sin servidor ni cuota)
npm run verify:images-flow  # recorrido real de las imágenes contra el servidor y el stub (ver más abajo)
npm run verify:cloudflare # MANUAL: 2 imágenes reales contra Cloudflare (gasta unas decenas de neuronas)
npm run verify:supabase  # esquema, RLS y mappers contra la base real
```

---

## Cómo se construyó

Nueve fases, cada una verificada antes de pasar a la siguiente; después se añadió una décima.

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Base: Next.js, TypeScript, Tailwind, contratos de tipos, layout y navegación. | Completa |
| 2 | Proyectos: asistente, CRUD, almacenamiento. | Completa |
| 3 | Technology Engine: catálogo, selección, combinación y conflictos. | Completa |
| 4 | Prompt Engine: plantillas, composición, Seed String Engine, restricciones. | Completa |
| 5 | LLM Layer: interfaz, Mock, Gemini, Groq, orquestador. | Completa |
| 6 | Landing Generator: generación, validación, preview. | Completa |
| 7 | Critic Engine: auditoría, recomendaciones, refinamiento. | Completa |
| 8 | Landing Library: almacenamiento, búsqueda, filtros, reutilización. | Completa |
| 9 | QA: errores, responsive, seguridad, accesibilidad, rendimiento. | Completa |
| 10 | Editor de código e inspector: editar el HTML generado, guardarlo como versión y saltar a la línea de cada elemento (decisión 11). | Completa, salvo la localización de reglas CSS (ver "Límites conocidos") |

---

## Qué cambió al conectar los servicios reales

Las claves de Supabase, Gemini y Groq destaparon defectos que el modo demo no podía
revelar. Quedan aquí porque son el tipo de cosa que vuelve a morder:

| Área | Qué estaba mal | Arreglo |
| --- | --- | --- |
| `testConnection()` | Pedía 16 tokens de salida. Los modelos con razonamiento los gastan pensando y devuelven texto vacío: **Ajustes mostraba «Error» con la clave válida**. | 512 tokens, y el adaptador distingue «presupuesto agotado razonando» de «respuesta vacía». |
| Catálogo de modelos | Escrito de memoria. La familia `gemini-2.5-*` y los `llama-*` de Groq estaban retirados. | Verificado llamando a cada modelo. `src/lib/llm/models.ts` lleva la fecha. |
| `maxOutputFor()` | Acotaba a 8192 cualquier modelo desconocido → **truncaba landings en silencio**. | Si no conoce el modelo, no acota: valida la API. |
| Presupuesto por defecto | 16 K, compartido con los tokens de razonamiento. | 32 K. |
| Modo JSON en Groq | Groq exige la palabra «json» en los mensajes o responde 400. | El adaptador lo garantiza sin depender de cómo esté redactado el prompt. |
| Errores 503 | Se comunicaban como «el proveedor tiene problemas». | Se distingue «ese modelo está saturado»; el reintento espera 5 s en vez de 1,2 s. |
| Errores 429 | Mensaje genérico. | Si el proveedor envía `retry-after`, se dice cuántos segundos. |
| Catálogo duplicado | Vivía en los adaptadores **y** en el generador de `seed.sql`, ya divergentes. | Unificado en `src/lib/llm/models.ts`. |
| URL de Supabase | Pegar la del endpoint REST (`…/rest/v1/`) rompía el cliente. | `normalizeSupabaseUrl()` recorta al origen en servidor, cliente y middleware. |
| Enfriamiento del limitador | Bloqueaba «generar y auditar» seguidos en modo demo. | El modo demo queda exento: no consume cuota de nadie. |
| Conexión a Supabase | El host directo es solo IPv6; en una red sin IPv6 el fallo llega como `ENOTFOUND` y parece una errata. | `db:setup` diagnostica el caso y recomienda el pooler. |
| Prompt de refinamiento | Incrustaba las 17 secciones **más** el HTML: ~10 300 tokens, por encima del límite por petición de Groq (413). | Solo las 7 secciones vinculantes: ~6 000 tokens. El resto ya está en el HTML. |
| Errores 413 | Caían en `unknown` → «vuelve a intentarlo», que es **falso**: reintentar no encoge la petición. | Código `too_large` propio con mensaje y pista accionables. |
| Recorte del HTML en el crítico | Truncaba a 60 K caracteres **en silencio**: el auditor reportaba como ausentes secciones que sí estaban. | El recorte se declara en el prompt para que no infiera lo que no ve. |
| Modelos por defecto en `env.ts` | Seguían siendo los retirados, y ese fallback gana sobre el del adaptador. | `gemini-flash-latest` y `openai/gpt-oss-120b`. |
| Enfriamiento entre llamadas de una misma acción | "Generar prompt" hace Seed + composición seguidas, separadas por 1-2 s — menos que `RATE_LIMIT_COOLDOWN_MS`. La segunda se bloqueaba casi siempre y **caía al borrador determinista en silencio**, indistinguible de un éxito. | `checkRateLimit(userId, { skipCooldown })`: la llamada que continúa una acción ya limitada salta el enfriamiento (no la ventana por hora). Ver [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md#el-enfriamiento-entre-pasos-internos-de-una-misma-acción). |
| Fallback silencioso al borrador | Cualquier fallo de composición (el enfriamiento de arriba, un 429 real de Groq, un timeout) devolvía el borrador determinista como si fuera un éxito: la respuesta era un `BuiltPrompt` válido sin ninguna marca. | `BuiltPrompt.composedByLLM: boolean`. El Prompt Studio avisa y cambia el badge cuando es `false` con un proveedor real configurado. |
| Altura de la vista previa ignorada | `LandingPreview` combinaba `flex-1` (base `0%`) con una clase de altura: en un contenedor sin altura definida, `flex-basis` anula `height`, y el marco medía lo que su contenido (~176 px) en vez del `h-[clamp(…)]` que se le pasaba. Se vio al construir el inspector, donde una vista previa de 150 px no servía. | Fuera de pantalla completa usa `flex-none`; solo en pantalla completa (contenedor con altura definida) queda `flex-1`. |
| Técnicas de diseño ignoradas en la composición real | `buildPromptForProject` tenía `designTechniques: DEFAULT_TECHNIQUE_IDS` fijo: marcar o desmarcar técnicas en el Prompt Studio no cambiaba el prompt real (solo afectaba a la vista previa gratuita, ya no usada). | Acepta `designTechniques` como parámetro, hilado desde `/api/prompts/compose`. |

La tabla `generations` fue lo que permitió diagnosticarlos: los fallos del flujo se leían
ahí con su proveedor, modelo, estado y mensaje de error.

---

## Convenciones

### TypeScript

- `strict: true`. Sin `any`: ESLint lo marca como error.
- Los contratos viven en `src/types/`; el resto del código importa de ahí.
- Las funciones de dominio devuelven datos, no respuestas HTTP. La traducción a HTTP ocurre
  en los route handlers.
- Comentarios solo donde aportan: el *por qué* de una decisión, no el *qué* de una línea.

### Estructura

- `components/ui/` — sin estado, sin datos, usables desde Server Components.
- `components/layout/`, `components/preview/` — piezas transversales.
- `features/<dominio>/` — componentes de cliente con lógica de un dominio concreto. El editor
  (`features/editor/`) separa el estado de la interfaz: `use-landing-editor` (borrador,
  guardado, conflictos), `use-inspector-sync` (vista previa ↔ editor) y piezas de interfaz
  (`editor-controls`, `inspector-panel`, `code-workbench`) que reutilizan tanto
  `/library/[id]/edit` como la pestaña "Codigo" del Prompt Studio.
- `components/editor/` — el editor CodeMirror. Se importa **solo** a través de
  `html-code-editor.lazy.tsx` (carga diferida, sin SSR): pesa cientos de KB y solo hace falta en
  las pantallas de edición.
- `lib/preview/` — instrumentación del documento de la vista previa y runtime del inspector.
  `instrument.ts` y `messages.ts` no importan nada del proyecto en tiempo de ejecución, para que
  `scripts/verify-inspector.mjs` pueda ejecutarlos directamente con Node.
- `services/` — lógica de negocio. No importa React ni Next.
- `lib/` — infraestructura: datos, proveedores, sesión, validación, utilidades.

Ningún componente llama a un proveedor LLM ni al SDK de Supabase directamente.

Estado que debe compartirse entre el layout y una página (no solo dentro de un componente)
vive en un React Context en `components/layout/`, con el valor inicial calculado en el
Server Component del layout y una única fuente de verdad en cliente — así lo hace el
proveedor de IA "activo" (`active-provider-context.tsx`): el Prompt Studio escribe en él al
elegir proveedor, y el indicador de la barra lateral lo lee, sin recargar la página.

### Estilos

Tailwind v4 con tokens en `src/app/globals.css`. Los colores se declaran como variables CSS
y se exponen a Tailwind con `@theme inline`, de modo que `bg-panel` o `text-muted` cambian
solos en modo oscuro sin escribir `dark:` en cada clase.

La aplicación no usa degradados, glassmorphism ni sombras difusas: superficie, línea de 1 px
y jerarquía tipográfica. Es la misma disciplina que el Prompt Engine exige a las páginas que
genera.

Tres reglas que salieron de verificar el editor a 360 px y en modo oscuro (cada una había
producido un fallo real):

- **Cuadrículas de una columna y contenido de ancho imprevisible.** Un hijo de una
  `grid` sin columnas explícitas tiene `min-width: auto`, así que su contenido (líneas largas
  del editor, una cadena hexadecimal, un nombre de clase de 80 caracteres) ensancha la pista y
  toda la página gana scroll horizontal —o, peor, pierde su margen derecho sin scroll—. Ponle
  `min-w-0` al hijo y, en la cuadrícula, `grid-cols-[minmax(0,1fr)]`. Por debajo de `xl` las
  cuadrículas de dos columnas del Studio son de una sola, así que esto aplica a **todos** los
  anchos menores de 1280 px, no solo al móvil.
- **Cadenas que vienen del HTML de la página** (ids, clases, Seed String): `break-all` (o
  `[overflow-wrap:anywhere]`) además de `min-w-0`. Con el solo `min-w-0` el texto se sale de su
  tarjeta y el scroll horizontal sigue ahí.
- **Contraste del texto secundario.** `--faint` (y `text-faint`) queda por debajo de 4,5:1 sobre
  los fondos de la aplicación (3,4–4,1 medido en claro y oscuro): úsalo solo para detalles no
  esenciales. Para texto que hay que leer —números de línea, comentarios del editor, notas de
  ayuda— usa `--muted`.

### Nombres

Español en la interfaz, los comentarios y la documentación. Inglés en el código
(identificadores, tipos, rutas) y en las secciones canónicas del prompt.

---

## Añadir cosas

### Una tecnología

Desde la interfaz: **Tecnologías → Añadir tecnología**. Queda asociada a tu cuenta.

Para el catálogo común, añádela a `PRESET_TECHNOLOGIES` en `src/lib/data/catalog.ts` y
ejecuta `npm run seed:sql`. Lo importante es `promptInstructions`: es el bloque que el
Prompt Composer inyecta.

### La Seed String

Ya no se crea desde la interfaz: no hay catálogo. Si «Cadenas Semilla» está elegida, cada
ejecución genera un string aleatorio nuevo (técnica *String Seed of Thought*) en
[`seed-engine.ts`](../src/services/prompt-engine/seed-engine.ts), y es el propio modelo que
compone el prompt quien lo manipula para derivar una dirección creativa. Sin esa técnica no hay
string ni sección `SEED STRING`. Detalle completo en
[`SEED_ENGINE_MIGRATION.md`](SEED_ENGINE_MIGRATION.md).

### Una técnica de diseño

Añade una entrada a `DESIGN_TECHNIQUES` en
`src/services/prompt-engine/design-techniques.ts` y su id a `DesignTechniqueId`. Aparece
sola en el Prompt Studio.

Añade también sus frases distintivas a `TECHNIQUE_FINGERPRINTS`
(`src/services/prompt-engine/composed-prompt.ts`): es un `Record` exhaustivo, así que TypeScript
no compila hasta que lo hagas. Es lo que permite detectar que un LLM coló el texto de la técnica
cuando el usuario **no** la eligió. Elige frases largas y propias de la técnica (una corta
podría salir de una redacción legítima) y no menciones la Seed en su texto: una técnica no puede
referirse a otra que quizá no esté elegida. Después ejecuta `npm run verify:prompt`.

### Un proveedor LLM

Ver [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md).

### Un endpoint

```ts
import { parseBody, withContext } from '@/app/api/_lib/route-helpers';

export async function POST(request: Request) {
  return withContext(async (ctx) => {
    const input = await parseBody(request, miEsquema);
    return miServicio(ctx, input);   // devuelve datos, no Response
  });
}

export const dynamic = 'force-dynamic';
```

`withContext` resuelve la sesión, garantiza el perfil, captura las excepciones y las
traduce a la forma `{ error }` con el estado HTTP correcto.

### Un mensaje nuevo entre la vista previa y el inspector

El contrato vive en cuatro sitios que hay que tocar juntos:

1. `src/types/preview.ts` — el tipo del mensaje (`PreviewToFrame` / `PreviewFromFrame`).
2. `src/lib/preview/inspector-runtime.ts` — quien lo envía o lo recibe dentro del iframe. La
   función debe seguir siendo **autocontenida** (se serializa con `toString()`): nada de
   importaciones ni de constantes del módulo dentro de su cuerpo.
3. `src/lib/preview/messages.ts` — `parseFrameMessage`, si el mensaje viene del iframe. Lo que
   llega de ahí es dato no confiable (el HTML generado corre en el mismo iframe): valida el
   tipo, acota las cadenas y comprueba los rangos de las posiciones.
4. `src/components/preview/landing-preview.tsx` — el `switch` que lo procesa en el padre.

Después añade el caso a `scripts/verify-inspector.mjs` y ejecútalo: comprueba que el runtime
sigue corriendo en un contexto `vm` sin acceso al módulo.

---

## Verificación

### Recorrido de aceptación

`scripts/verify-flow.mjs` comprueba el flujo completo de punta a punta:

```bash
npm run dev          # en una terminal
npm run verify:flow  # en otra: modo demo, sin Supabase ni claves
```

Recorre crear proyecto → DISCOVER → componer prompt → generar → validar → auditar →
refinar → variante → versiones → biblioteca → reutilizar → edición manual del HTML, y
comprueba además el aislamiento entre cuentas, el 401 sin sesión y el 422 ante entrada
inválida. La edición manual cubre `PUT /api/landings/[id]/html`: versión nueva y vigente, HTML
guardado tal cual, no-op sin cambios, `422` ante un HTML vacío o un fragmento, `409` con una
versión base desfasada, `403` sobre una página pública de otra cuenta, y que el crítico
audita el HTML editado. Sale con
código 1 si algo falla, así que sirve en un pipeline.

```
PASS  POST /api/prompts/generate  secciones=17
PASS  Generacion marcada como demo (no se atribuye a Gemini/Groq)
PASS  La segunda auditoria encuentra menos problemas  4 -> 0 (score 92 -> 100)
PASS  Un usuario no puede leer el proyecto de otro  status=404
…
TODO CORRECTO
```

#### Contra un proveedor real

```bash
npm run verify:flow -- --provider=gemini
npm run verify:flow -- --provider=groq
npm run verify:flow -- --provider=gemini --model=gemini-3.5-flash
npm run verify:flow -- --base=http://localhost:3001 --pause=10
```

| Parámetro | Por defecto | Para qué |
| --- | --- | --- |
| `--provider` | `mock` | `mock`, `gemini` o `groq`. Con un proveedor real se comprueba que la generación queda **atribuida a él y no al modo demo**. |
| `--model` | el del proveedor | Fijar un modelo concreto, útil cuando el habitual devuelve 503. |
| `--base` | `http://localhost:3000` | Apuntar a otro servidor. |
| `--pause` | 3,5 s (65 s en Groq) | Segundos entre llamadas que consumen cuota. |

Las aserciones específicas del modo demo (aplicación determinista de las mejoras, número de
hallazgos que baja) solo se comprueban con `mock`: con un modelo real la salida no es
determinista y verificar un número concreto sería una prueba frágil.

**Probar proveedores reales sin tocar tu Supabase.** Levanta un segundo servidor con el
almacén local y apunta ahí:

```bash
NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev -p 3001
npm run verify:flow -- --base=http://localhost:3001 --provider=gemini
```

Así no se crean cuentas ni datos en el proyecto de Supabase.

> Si `.env.local` tiene claves de Supabase y el servidor arranca en modo Supabase a pesar de
> las variables vacías (comprobado lanzándolo desde un arrancador que pasaba las variables con
> un espacio), crea un `.env.development.local` con esas mismas claves vacías: Next le da
> prioridad sobre `.env.local`, está ignorado por git y funciona igual en todas las
> plataformas. Para verificar un build de producción, el equivalente es
> `.env.production.local`. Bórralo al terminar, o tu servidor habitual arrancará también sin
> Supabase.

Empieza con la base limpia: para el servidor, borra `./.data` y vuelve a arrancar. Borrar
solo la carpeta no basta — `LocalDataStore` mantiene la base en memoria del proceso.

**No ejecutes `npm run build` mientras un servidor de desarrollo esté corriendo.** Comparten
el directorio `.next` y el build se lo deja inservible a mitad de ejecución, con errores
`Cannot find module './chunks/vendor-chunks/…'` que parecen un fallo del código y no lo son.

#### Qué está verificado con cada proveedor

Resultados reales, no aspiracionales:

| Paso | `mock` | `gemini` | `groq` |
| --- | --- | --- | --- |
| DISCOVER → DEFINE | Sí | Sí | Sí |
| Composición del prompt (17 secciones) | Sí | Sí | Sí |
| Generación + validación de salida | Sí | Sí | Sí |
| Atribución correcta al proveedor | Sí | Sí | Sí |
| Crítica | Sí | Sí | Sí |
| Refinamiento a v2 | Sí | Sí | Sí |
| Segunda crítica sobre la versión refinada | Sí | Sí | **No**: la página crecida supera el tope de 8 000 tokens por petición de Groq. |
| Variante como página independiente | Sí | Sí | Sí |
| Versiones, biblioteca, reutilización, búsqueda | Sí | Sí | Sí |
| Aislamiento entre cuentas, 401, 422 | Sí | Sí | Sí |

El único hueco es una **limitación de la capa gratuita de Groq**, no un defecto: la
aplicación lo reporta como `too_large` con la indicación de que reintentar no servirá. Para
páginas grandes, audita con Gemini.

Tamaños de página obtenidos: 6 529 caracteres con `gemini-3.1-flash-lite`, 40 067 con un
Flash completo, 14 642 con `openai/gpt-oss-120b`.

### Solo las técnicas elegidas

```bash
npm run verify:prompt      # no necesita servidor ni claves
```

Ejecuta los módulos reales de `src/services/prompt-engine/` con Node (el hook
`scripts/lib/ts-resolve-hook.mjs` resuelve el alias `@/`, las extensiones `.ts` y `server-only`)
y sustituye `runLLM` por respuestas simuladas —nunca llama a un modelo—. Comprueba:

1. **Borrador determinista**, en las 256 combinaciones de las 8 técnicas: el texto de una técnica
   y la sección `SEED STRING` aparecen si y solo si se eligieron; sin la Seed no queda ninguna
   mención a ella.
2. **Composición con LLM**, frente a modelos que no obedecen: que inventan `SUBTRACTIVE DESIGN` o
   `SEED STRING`, reescriben u omiten el bloque de técnicas, o cuelan una técnica no elegida en
   otra sección. Y que uno que obedece no dispara falsos positivos.
3. **La petición al modelo** describe el borrador real (número y títulos de secciones) y no habla
   de «17 secciones».

Prueba lo que el código garantiza, no lo que haría un modelo concreto. `verify:flow` añade el
recorrido por la API real (`POST /api/prompts/compose` con `[]` y con una técnica suelta).

Para ejecutar más módulos de `src/` de esta forma basta importarlos desde un script que registre
el hook; ojo con `@/services/llm-orchestrator`, que el hook sustituye siempre por el stub.

### Imágenes generadas con IA

Tres niveles, de menos a más real. Ninguno gasta cuota salvo el último.

```bash
npm run verify:images          # módulos reales + stub de Cloudflare, sin servidor
npm run verify:images-flow     # servidor real + stub: el recorrido completo
npm run verify:cloudflare      # MANUAL, API real de Cloudflare (2 imágenes)
```

**`verify:images`** levanta `scripts/stub-cloudflare.mjs` en un puerto libre y ejecuta los módulos
de `src/lib/images` y `src/services/image-generator`. Comprueba: formato y dimensiones por los
primeros bytes (PNG, JPEG, WebP; un SVG o un GIF se rechazan); los marcadores (se localizan solo los
`<img data-ai-image>`, el empalme deja el resto **byte a byte** igual, es idempotente, sobrevive a
CRLF y rechaza posiciones obsoletas); el cliente ante cada fallo (cuota 4006 y 3036, saturación,
5xx, credenciales, respuesta que no es imagen, imagen de más de 5 MB, timeout, cancelación); el
pipeline (éxito, fallos parciales con bloque neutro, reintento que solo pide lo pendiente, freno de
cuota, sin credenciales, tope por página, presupuesto por hora, sin tiempo, almacén caído, error
inesperado); y `env.ts` arrancando **con y sin** las variables, en procesos hijo.

**`verify:images-flow`** necesita el stub y un servidor en modo local con el demo como proveedor de
texto (el demo deja el marcador y el servidor lo rellena llamando al stub: es el mismo camino que con
Gemini o Groq):

```bash
node scripts/stub-cloudflare.mjs                       # terminal 1
```

```env
# .env.development.local  (temporal; ver docs/ENVIRONMENT.md)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DEFAULT_LLM_PROVIDER=mock
CLOUDFLARE_API_BASE_URL=http://localhost:8788
CLOUDFLARE_ACCOUNT_ID=stub-account
CLOUDFLARE_API_TOKEN=stub-token
```

```bash
npm run dev                                            # terminal 2
npm run verify:images-flow                             # terminal 3
```

Usa su propia cuenta (`e2e-images@estudio.test`), así que no exige una base vacía como `verify:flow`.
Comprueba que el prompt pide marcadores; que la generación los resuelve con una URL corta y sin
bytes en el HTML; que la imagen se sirve **sin cookie** y que `../` o un uuid desconocido dan 404;
que un fallo no tumba la generación, deja un marcador visible y llega como aviso; que
«Reintentar imágenes» lo completa creando la versión «Imagenes»; y que refinar y el guardado
manual aceptan el HTML con las URLs. Para cambiar el resultado de una imagen se usa una palabra
clave en el tema del proyecto (`__fail_twice__`, `__quota__`…, ver la cabecera del stub).

**Lo que un script no cubre y se comprobó a mano en un navegador** (receta de modo local):

- *La imagen se ve dentro del iframe sandbox.* Hallazgo clave: desde el origen opaco las peticiones
  a `localhost` se bloquean (ni un `fetch` `no-cors` sale), así que la vista previa **incrusta** las
  imágenes como `data:`. Para comprobarlo sin fiarse del aspecto, crea un iframe con el mismo
  `sandbox` y el `srcdoc` real, y mide `naturalWidth` por `postMessage` (con `loading="eager"`:
  una imagen `lazy` aún no ha cargado al medir). Control imprescindible: un `data:` válido debe
  cargar, o la prueba no prueba nada.
- La biblioteca (miniaturas `sandbox=""`), la ficha («Imágenes 1/1», «Reintentar imágenes»,
  descargar y copiar con imágenes incrustadas) y el panel de Ajustes.

**`verify:cloudflare`** es la única prueba contra la API real: mide formato y **resolución** de la
salida de schnell (no documentados), la latencia y las neuronas estimadas por imagen, y guarda las
imágenes en `.data/cloudflare-spike/`. Necesita `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN` en
`.env.local`; sin ellas, explica cómo conseguirlos y sale con código 2. **Aún no se ha ejecutado con
credenciales reales**: todo lo demás se verificó contra el stub, que imita la documentación de
Cloudflare, no la API.

### Editor de código e inspector

```bash
npm run verify:inspector   # no necesita servidor ni claves
```

Ejecuta `src/lib/preview/instrument.ts` sobre casos que rompen a los mapeos ingenuos —etiquetas
autocerradas y de SVG, atributos con `>` entre comillas, `<script>` con marcado falso,
`tbody` implícito, tablas mal formadas, emojis (UTF-16), `\r\n`, `<template>`, fragmentos sin
`<html>`— **y sobre las landings reales de `.data/db.json`** si existen. Por cada elemento
comprueba que la posición guardada apunta al `<` de su etiqueta; que el árbol instrumentado es
idéntico al original (las marcas no alteran atributos ni estructura); y que quitar marcas y
script devuelve el texto original, byte a byte. Además prueba `parseFrameMessage` (qué mensajes
del iframe se aceptan) y ejecuta el runtime del inspector en un contexto `vm` sin acceso al
módulo, para detectar dependencias ocultas.

Lo que **no** puede cubrir un script: que un clic real en el iframe aislado llegue al editor.
Eso se comprueba a mano en `/library/[id]/edit` (o en la pestaña "Codigo" del Prompt Studio):
activa "Inspeccionar", haz clic en un título y comprueba que el editor selecciona su etiqueta en
la línea correcta (el chip de la barra muestra `Linea N:col`). Comprueba también que el HTML
guardado y el que abre "Abrir en una pestaña nueva" no contienen `data-ale-src`.

### Responsive y modo oscuro del editor

Verificado a mano en un servidor local (ver [`ENVIRONMENT.md`](ENVIRONMENT.md#forzar-el-modo-local-sin-tocar-envlocal)).
Qué se comprobó, exactamente:

| Pantalla | Anchos | Esquemas |
| --- | --- | --- |
| `/library/[id]/edit` | 360 px (con los estados: seleccionado, sin guardar, conflicto, guardado con avisos); 1440 px en una pasada anterior | claro y oscuro a 360 |
| `/library/[id]` (ficha) | 360 px | claro y oscuro |
| Prompt Studio, pestaña "Codigo" | 360, 768, 1024 y 1440 px | oscuro a 360 y 1440, claro a 768 y 1024 |

Se midió en vez de mirar: ancho del documento frente al del viewport, elementos que sobresalen,
tamaño de los botones y relación de contraste WCAG de cada color del editor contra su fondo
real.

Lo que encontró, ya corregido: el aviso de conflicto quedaba ilegible a 360 px (el componente
`Alert` dejaba las acciones a la derecha sin encogerse; ahora pasan debajo del texto en
pantallas estrechas); el panel del inspector ensanchaba la página con ids o clases largas; el
editor del Studio ensanchaba la página por debajo de 1280 px; la ficha de la biblioteca se
desbordaba por la cadena del Seed String (defecto previo al editor); la barra de configuración
del Studio empujaba el contenido 16 px fuera de su margen a 360 px (también previo); y
números de línea, comentarios y notas de ayuda del editor no llegaban a 4,5:1 en oscuro.

Estado final en lo comprobado: sin scroll horizontal, tarjetas del Studio alineadas con el
margen a 360 px, y el editor con un contraste mínimo de 4,81:1 en claro y 6,2:1 en oscuro
(insignia de estado aparte, ver "Límites conocidos"). **Sin comprobar:** la pantalla de edición
a 768 y 1024 px (su cuadrícula es la misma que la del Studio y lleva `min-w-0`, pero no se
midió), la ficha a anchos distintos de 360 px, y el modo oscuro de la pantalla de edición fuera
de 360 px.

### Checklist por módulo

- [ ] `npm run typecheck` sin errores.
- [ ] `npm run lint` sin avisos.
- [ ] `npm run build` completa.
- [ ] Estados cubiertos: vacío, cargando, éxito, error.
- [ ] El error se ve como mensaje humano, no como traza.
- [ ] Funciona a 360 px de ancho sin desbordamiento horizontal.
- [ ] Navegable con teclado, con foco visible.
- [ ] Ninguna clave de API llega al bundle del navegador.

### Accesibilidad

Aplicada tanto a la aplicación como a lo que genera:

- HTML semántico y un único `h1` por página.
- Enlace «Saltar al contenido» como primer elemento enfocable.
- `:focus-visible` con 2 px de contorno y offset.
- `<label>` asociado a cada campo; los errores usan `role="alert"`.
- `aria-expanded` / `aria-pressed` en los controles que cambian de estado.
- `@media (prefers-reduced-motion: reduce)` desactiva las animaciones no esenciales.
- Modo oscuro por `prefers-color-scheme`, con contraste comprobado en ambos.
- Editor de código: el área de edición lleva `aria-label`; Tab sangra, así que **Esc y luego Tab**
  sacan el foco del editor (`Ctrl+M` lo alterna); el botón "Inspeccionar" usa `aria-pressed`; el
  destello del salto respeta `prefers-reduced-motion`. El tema del editor usa las variables
  CSS de la aplicación y cambia solo en modo oscuro.

### Responsive

| Ancho | Comportamiento |
| --- | --- |
| < 640 px | Una columna. Navegación en menú desplegable. Prompt y preview apilados. |
| 640–1024 px | Retículas de 2 columnas. |
| > 1024 px | Barra lateral fija. |
| > 1280 px | Prompt Studio a dos columnas: prompt \| preview. La pantalla de edición (`/library/[id]/edit`) también: código \| vista previa con inspector; por debajo se apilan. |

---

## Límites conocidos

- **Almacén local**: sin transacciones ni concurrencia. Es para desarrollo y evaluación.
  Producción = Supabase + RLS.
- **Limitador en memoria**: con varias instancias haría falta Redis o una tabla. La
  interfaz del módulo no cambiaría.
- **Sin streaming**: la generación devuelve el documento completo. La preview muestra
  estado de carga mientras tanto. Añadirlo implicaría cambiar `LLMProvider.generate` por un
  método que devuelva un `ReadableStream`.
- **El Mock Provider analiza el prompt** para reconstruir el brief. Es fiable porque el
  formato lo emite esta misma aplicación, pero depende de que las etiquetas de sección se
  mantengan sincronizadas entre `prompt-engine/index.ts` y `mock/brief-parser.ts`.
- **El catálogo de modelos caduca.** Los proveedores retiran identificadores sin avisar y
  sin quitarlos del listado. `src/lib/llm/models.ts` lleva la fecha de verificación; si algo
  devuelve 404, revísalo llamando al modelo, no listando.
- **Las cuotas gratuitas son estrechas** para este caso de uso: una generación son ~3,5 K
  tokens de entrada y hasta 12 K de salida. Gemini limita por día y modelo; Groq, a 8 000
  tokens **por minuto y por petición** — este segundo tope es duro y no se espera: auditar
  una página de más de ~20 KB no cabe. Ver
  [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md#límites-y-coste).
- **Los modelos se saturan.** Un `503` en el modelo recién salido es habitual; uno más
  antiguo suele responder. No es un fallo de la aplicación y conviene no diagnosticarlo como
  tal: la tabla `generations` guarda el estado y el mensaje del proveedor.
- **Las técnicas de diseño se imponen sobre la respuesta del LLM, pero solo de forma literal.**
  El prompt lleva únicamente las elegidas: el bloque de técnicas se restaura del borrador, las
  secciones inventadas se descartan y el texto de una técnica no elegida colado en otra sección
  se rechaza. La detección es por frases, no semántica: una paráfrasis no se detecta. Y se
  comprobó con respuestas simuladas, no con un modelo real. Detalle en
  [`PROMPT_ENGINE.md`](PROMPT_ENGINE.md#con-el-llm-qué-se-garantiza-y-qué-no).
- **Imágenes generadas** (decisión 12):
  - La cuota gratuita de Cloudflare (10 000 neuronas/día, ~170-230 imágenes) es de la cuenta y hay
    reportes de 429/`4006` que persisten tras el reinicio de las 00:00 UTC. Resolución y formato de
    schnell: por medir (`verify:cloudflare`).
  - La generación es una sola petición: no hay progreso por imagen (haría falta streaming), y el
    paso de imágenes tiene un plazo de 45 s; lo que no quepa queda pendiente y se reintenta.
  - Solo se generan los marcadores del HTML en la generación inicial; refinar y variar conservan
    las imágenes pero no generan ni regeneran, y no se puede regenerar una imagen suelta.
  - Las URLs `/api/landing-images/<uuid>` son públicas (el `uuid` es la capacidad de lectura).
  - Las vistas que pintan el HTML en un iframe sandbox **deben incrustar** las imágenes
    (`useInlinedImages`): una URL relativa no carga desde el origen opaco en `localhost`. Si añades
    otra vista con `srcDoc`, úsalo.
  - **Con Supabase, hay que ejecutar `npm run db:setup` antes de usar la técnica** (crea la tabla
    `landing_images` y el bucket). Sin ello Cloudflare genera la imagen pero no se puede guardar:
    el aviso lo dice y se frena la generación 60 s para no gastar neuronas. `npm run db:check` lo
    diagnostica sin escribir nada. Las políticas de Storage no se han probado contra tu base (ver
    [`DATABASE.md`](DATABASE.md)).
- **Editor de código e inspector** (decisión 11):
  - No localiza la **regla CSS** que afecta a un elemento, solo su etiqueta. Un estilo
    incorrecto suele vivir en un `<style>`, no en la etiqueta: hoy hay que buscarlo en el editor
    (`Ctrl+F`). Una forma de hacerlo sería recorrer `document.styleSheets` en el runtime
    (solo los `<style>` en línea: las hojas externas lanzan `SecurityError`), comprobar qué
    reglas encajan con `el.matches(selectorText)` y ubicarlas en el texto con un tokenizador CSS
    pequeño. No está implementado.
  - Un elemento que crea el JavaScript de la propia página no está en el código: el inspector
    devuelve el ancestro marcado más cercano y lo indica.
  - Con el HTML minificado en una sola línea, la línea no ayuda (se muestra la columna).
  - Cada guardado es una versión y no hay pantalla para **restaurar** una versión anterior ni
    compararlas; es el siguiente paso natural.
  - El borrador sin guardar vive en `localStorage` del navegador: no se comparte entre
    dispositivos.
  - La insignia verde de estado (`Badge` con tono `ok`: `--ok` sobre `--ok-soft`) mide 4,37:1 en
    modo claro, por debajo de 4,5:1. Es el componente compartido, no el editor; corregirlo
    implica retocar el token `--ok`, que afecta a toda la aplicación.
  - Las herramientas de navegador automatizadas no entregan de forma fiable clics al `iframe`
    aislado: el clic real hay que comprobarlo a mano.
