# Arquitectura

## Principio rector

Cada capa depende solo de la de abajo y nunca al revés. Un componente de React no sabe si
detrás hay Gemini, Groq o el generador determinista; un servicio no sabe si los datos van a
PostgreSQL o a un JSON en disco.

```
┌──────────────────────────────────────────────────────────────┐
│  app/            Rutas, páginas y route handlers             │
├──────────────────────────────────────────────────────────────┤
│  features/       Componentes con lógica de dominio           │
│  components/     Kit de interfaz sin estado                  │
├──────────────────────────────────────────────────────────────┤
│  services/       Lógica de negocio pura                      │
│    prompt-engine · llm-orchestrator · output-validator       │
│    landing-generator · critic-engine · discover-engine       │
│    image-generator  marcadores <img data-ai-image> → FLUX    │
├──────────────────────────────────────────────────────────────┤
│  lib/                                                        │
│    data/  DataStore ──┬── SupabaseDataStore                  │
│                       └── LocalDataStore                     │
│    llm/   LLMProvider ┬── GeminiProvider                     │
│                       ├── GroqProvider                       │
│                       ├── OllamaProvider                     │
│                       └── MockProvider                       │
│    auth/ · validation/ · env · errors · rate-limit           │
│    credentials/  claves por usuario, cifradas, con respaldo  │
│                  en el entorno                               │
│    preview/ · instrumentación y runtime del inspector        │
│    images/  cliente Cloudflare · marcadores · límites        │
├──────────────────────────────────────────────────────────────┤
│  types/          Contratos compartidos                       │
└──────────────────────────────────────────────────────────────┘
```

---

## Flujo de una generación

El Prompt Studio separa componer de generar en dos peticiones explícitas (ver decisión 10):
primero se ve el prompt real, después se decide si generar el HTML con él.

```
Usuario pulsa "Generar prompt"
        │
        ▼
POST /api/prompts/compose ──► Zod valida la entrada
        │
        ▼
composeAndPersistPrompt (landing-generator)
  1. carga el proyecto y comprueba que es generable
  2. prompt-engine compone las secciones, hasta 17 (borrador determinista)
       · composer resuelve el stack y sus conflictos
       · SSoT Seed Engine genera el string aleatorio de la Seed, solo si
         «Cadenas Semilla» está elegida
       · design-techniques inyecta únicamente las técnicas elegidas
  3. con proveedor real: hasta dos llamadas LLM más reescriben el borrador
     (Seed + composición) y el código impone sobre la respuesta que solo
     aparezcan las técnicas elegidas — ver decisión 9
  4. guarda prompt + prompt_version  ◄── trazabilidad
        │
        ▼
El usuario revisa el prompt ya compuesto (14-17 secciones según las técnicas) en pantalla
        │
        ▼
Usuario pulsa "Generar HTML"
        │
        ▼
POST /api/generations (con promptVersionId) ──► Zod valida la entrada
        │
        ▼
landing-generator
  genera directo desde esa prompt_version, sin recomponer nada
  crea generations(status='pending')
        │
        ▼
llm-orchestrator
  · resuelve proveedor (degrada a demo si no hay clave)
  · aplica el limitador de uso (solo proveedores externos)
  · fija timeout y permite cancelación
  · un único reintento ante fallo transitorio
        │
        ▼
LLMProvider.generate()  ──► Gemini | Groq | Ollama | Mock
        │
        ▼
output-validator
  · quita bloques de markdown y texto conversacional
  · envuelve fragmentos sueltos en un documento
  · comprueba estructura, tamaño y compatibilidad con srcDoc
  · separa errores bloqueantes de avisos
        │
        ├── inválido ──► generations(status='invalid_output') + AppException
        │
        ▼ válido
  4b. si la página lleva marcadores <img data-ai-image> (técnica "Generación de
      imágenes"): image-generator genera cada imagen con FLUX (Cloudflare), la
      guarda aparte y deja en el HTML una URL corta. Lo que falle queda como
      marcador visible y se puede reintentar — decisión 12. No es fatal.
  5. crea landing_page + landing_version
  6. generations(status='success', latencia, tokens, avisos)
        │
        ▼
Preview Engine: <iframe srcDoc sandbox>
        │
        ├── Edición manual (opcional, ver decisión 11)
        │     editor de código + inspector ──► PUT /api/landings/[id]/html
        │     ──► nueva versión "Edicion manual", vigente desde ese momento
        ▼
Critic Engine (a petición) ──► issues + sugerencias + puntuaciones
        │
        ▼
Refinamiento con las sugerencias aceptadas ──► nueva versión
```

---

## Decisiones arquitectónicas

### 1. Capa de datos abstracta con dos implementaciones

**Decisión.** La persistencia pasa por la interfaz `DataStore`
(`src/lib/data/types.ts`), con `SupabaseDataStore` y `LocalDataStore`.

**Motivo.** El criterio de aceptación exige que el flujo completo funcione sin servicios de
pago. Supabase es gratuito pero requiere crear un proyecto y ejecutar tres scripts: eso
rompe el arranque en frío de quien solo quiere ver la aplicación funcionando. Con esta capa,
`npm install && npm run dev` basta, y en cuanto se rellenan las variables de entorno la
aplicación usa Supabase sin cambiar una línea de interfaz.

**Alternativas.** Solo Supabase (rompe el arranque en frío); SQLite (añade dependencia
nativa y un segundo dialecto SQL que mantener); memoria volátil (se pierde el trabajo en
cada recarga del servidor de desarrollo).

**Coste.** Dos implementaciones que mantener en paralelo. Se acota manteniendo la interfaz
pequeña y explícita, y pasando `ownerId` a todos los métodos.

### 2. Capa de proveedores LLM con interfaz común

**Decisión.** `LLMProvider` (`src/types/llm.ts`) es la única forma de hablar con un modelo.
Los adaptadores traducen sus errores a `LLMError`, con códigos normalizados.

**Motivo.** Añadir OpenAI, Anthropic u OpenRouter debe ser implementar una clase y
registrarla, sin tocar el núcleo. Además permite que el modo demo sea un proveedor más y no
un caso especial repartido por el código.

**Alternativas.** Llamar a los SDK desde los servicios (acopla el dominio al proveedor);
una librería de abstracción externa (dependencia grande para tres proveedores).

**Refinamiento posterior.** El catálogo de modelos se extrajo a
`src/lib/llm/models.ts`, sin dependencias de entorno, porque lo necesitaban dos consumidores
distintos: los adaptadores (`server-only`) y el generador de `supabase/seed.sql`, que corre
fuera de Next.js. Antes estaba duplicado y las dos copias ya habían divergido.

### 3. Mock Provider como proveedor de primera clase

**Decisión.** El modo demo implementa la misma interfaz y produce HTML real mediante un
generador determinista, y auditorías reales mediante análisis estático del HTML.

**Motivo.** El requisito prohíbe simular integraciones. Un mock que devolviera texto fijo
no permitiría validar preview, versionado ni el bucle crítico/refinamiento. El generador
produce páginas semánticas, responsive y accesibles, con estilo variable según la Seed; el
crítico ejecuta comprobaciones verificables (falta `lang`, imágenes sin `alt`, ausencia de
Open Graph, formulario sin micro-copy de privacidad…).

**Honestidad.** Toda respuesta del modo demo viaja con `isMock: true` y se etiqueta como
demo en la interfaz, en `generations.is_mock` y en `<meta name="generator">`.

### 4. Route handlers en lugar de Server Actions para el núcleo

**Decisión.** La generación, la crítica, el refinamiento y las variantes son endpoints
HTTP. Solo la autenticación usa Server Actions.

**Motivo.** Son operaciones largas que necesitan `AbortController`, `maxDuration` y estados
de carga granulares en cliente; además el enunciado pide una API interna explícita, y tener
endpoints permite probarla sin navegador.

**Alternativas.** Todo con Server Actions (menos control sobre cancelación y timeouts, y
más difícil de verificar de forma automatizada).

### 5. Objetos de valor en `jsonb`, relaciones en tablas

**Decisión.** `projects.basics/visual/technical/content`, `discover` y `define` son `jsonb`.
El stack, además, se indexa en la tabla `project_technologies`.

**Motivo.** Esos bloques se leen y escriben siempre juntos y evolucionan con el producto;
normalizarlos obligaría a una migración por cada campo nuevo del brief. Lo que sí hay que
consultar de forma relacional —«qué proyectos usan Next.js»— vive en su tabla.

**Coste.** La lista de tecnologías existe en dos sitios; el adaptador de Supabase las
sincroniza en el mismo método que escribe el proyecto.

### 6. Preview con `iframe` + `srcDoc` y origen opaco

**Decisión.** La página generada se renderiza con
`sandbox="allow-scripts allow-forms allow-popups allow-modals"`, sin `allow-same-origin`.

**Motivo.** El documento generado por un LLM es código no confiable. Sin
`allow-same-origin` corre en un origen opaco: puede ejecutar su propio JavaScript —lo que
permite comprobar que los menús y los formularios funcionan de verdad— pero no puede leer
cookies, `localStorage` ni acceder a la ventana padre. Nunca se usa
`dangerouslySetInnerHTML` para la página completa. El inspector de la decisión 11 se construyó
respetando este aislamiento: no se le añadió `allow-same-origin`.

**Consecuencia medida (decisión 12).** Desde ese origen opaco **no se puede pedir nada a
`localhost`**: ni un `<img src="/api/…">` ni un `fetch` con `no-cors` salen (comprobado en un
navegador real; las imágenes externas y los `data:` sí cargan). Lo que el iframe necesita de la
propia aplicación tiene que entrar ya dentro del `srcDoc`.

### 7. El refinamiento no reenvía el encargo entero

**Decisión.** Refinar y generar variantes incrustan solo siete secciones del encargo
original (`CONTEXT`, `TARGET_AUDIENCE`, `BUSINESS_GOAL`, `VISUAL_DIRECTION`, `SEED_STRING`,
`COPY_REQUIREMENTS`, `NEGATIVE_CONSTRAINTS` si el encargo la llevaba), no las 17.

**Motivo.** Esas peticiones ya envían el HTML completo. El stack, la arquitectura de
información y los criterios de calidad están encarnados en ese documento: repetirlos
duplicaba el tamaño sin aportar. Lo que sí hay que repetir es el contexto mínimo y las
restricciones que el modelo podría violar al reescribir.

**Medido.** De ~10 300 a ~6 000 tokens de entrada. Por encima de 8 000, la capa gratuita de
Groq rechaza la petición con `413`, así que el refinamiento era literalmente imposible allí.
En todos los proveedores: menos coste, menos latencia y menos riesgo de truncado.

**Alternativas.** Enviar solo los cambios y el HTML (el modelo pierde las restricciones
negativas y las reintroduce); resumir el encargo con otra llamada al modelo (duplica coste y
latencia para ahorrar tokens).

**Restricción heredada.** Los títulos de las cabeceras se conservan porque el Mock Provider
reconstruye el brief leyéndolos. Cambiarlos rompería el modo demo en silencio.

### 8. El prompt se versiona, no solo se guarda

**Decisión.** Cada ejecución crea una `prompt_version` inmutable, y cada Landing Page
apunta a la versión concreta que la produjo.

**Motivo.** La pregunta «¿qué prompt produjo esta página?» tiene que poder responderse
siempre. También permite comparar versiones y reproducir una generación.

**Edición manual.** Guardar HTML editado a mano (decisión 11) crea una `landing_version` pero
**no** una `prompt_version`: no hay un prompt nuevo. La versión manual conserva la
`prompt_version_id` del HTML del que partió, `generation_id` queda a `null`, y la ficha avisa de
que el HTML vigente ya no es exactamente el que produjo ese prompt.

### 9. El prompt lo escribe un LLM, no solo el código

**Decisión (revisada).** `buildLandingPrompt` sigue existiendo como función pura —mismo
proyecto, mismo borrador— pero con un proveedor real ya no es lo último que ocurre. Es el
**borrador**: `buildPromptForProject` (`landing-generator`) lo pasa por hasta dos llamadas
más al LLM antes de guardarlo como versión definitiva:

1. **`generateRandomSeedString`** genera el string aleatorio de la Seed con la técnica *String
   Seed of Thought* (Misaki & Akiba, ICLR 2026) — solo eso, sin traducirlo a nada todavía.
   Se ejecuta **solo si «Cadenas Semilla» está elegida**: la Seed ya no es una elección del
   proyecto ni existe un catálogo que consultar (ver
   [`SEED_ENGINE_MIGRATION.md`](SEED_ENGINE_MIGRATION.md)), pero sigue siendo una técnica de
   diseño más, y el prompt lleva únicamente las que se eligieron. Sin ella no hay string, ni
   sección `SEED STRING`, ni esta llamada.
2. **`composePromptViaLLM`** reescribe el borrador (entre 14 y 17 secciones según las técnicas
   elegidas). El stack tecnológico (lo elige el usuario, no el LLM), las restricciones negativas
   (solo si está elegida esa técnica)
   y el bloque de técnicas de diseño (`SUBTRACTIVE DESIGN`) viajan como bloques que el modelo
   debe copiar tal cual. Si hay Seed, la sección `SEED STRING` es distinta a propósito: en el
   borrador solo trae el string en crudo, y es este mismo modelo quien debe **manipularlo**
   (suma + módulo, hash…) para derivar la dirección creativa y escribirla ahí — exactamente
   la mitad de la técnica que el paso anterior no hizo. El resto —contexto, objetivo,
   dirección visual, copy…— lo redacta libremente.

El **modo demo sigue siendo 100 % determinista**: usa el borrador de `buildLandingPrompt`
sin pasar por la segunda llamada, y el string de la Seed (si está elegida) lo deriva un PRNG real
(`generateRandomSeedForMock`, `crypto.randomBytes`), no un LLM. Nadie manipula ese string en el
demo: `brief-parser.ts` (Mock) **no lo hashea**, solo busca palabras clave en él
(`detectSeedCategory`), y con un string aleatorio eso solo acierta por casualidad —medido con 5 000
strings: el 83 % cae en «editorial» (la familia por defecto) y el 17 % en «retro-tech», por
contener «80» en el hexadecimal; las otras 11 familias no salen nunca—. Es una discrepancia con la
intención original (ver [`SEED_ENGINE_MIGRATION.md`](SEED_ENGINE_MIGRATION.md)) que se deja
señalada en vez de corregirla a ciegas: variar el estilo del demo cambia lo que ve el crítico y
puede descuadrar `verify:flow`. `resolveProvider` decide esto mismo que decidirá el orquestador al ejecutar
de verdad, así que un proveedor real sin configurar tampoco llega a la llamada de
composición: cae al mismo camino que el modo demo.

**Motivo.** Determinismo total facilitaba versionar y cachear por hash, pero congelaba la
redacción del encargo a lo que el código sabía escribir de antemano. Se cambia
deliberadamente: la trazabilidad no depende de poder *recalcular* el mismo prompt
ejecutando la función dos veces, sino de que cada prompt —lo redacte quien lo redacte— quede
guardado de forma inmutable en `prompt_versions`. Eso no cambia.

**Coste.** Una generación con proveedor real pasa de 1 llamada a 3 (Seed + composición +
landing), del mismo orden que ya suponía activar DISCOVER; sin «Cadenas Semilla» son 2. Si el
modelo omite alguna de las secciones que debía redactar él, se cae al borrador determinista en
vez de fallar: nunca se deja al usuario sin prompt.

**Garantía: solo las técnicas elegidas, obedezca o no el modelo.** La petición al modelo no basta
—antes decía siempre «escribe las 17 secciones» y un modelo podía inventar el bloque de
técnicas—, así que el código lo impone sobre la respuesta (`reconcileComposedSections`,
`composed-prompt.ts`): descarta las secciones que el borrador no traía, restaura del borrador las
secciones fijas (`TECHNOLOGY`, `SUBTRACTIVE DESIGN`, `NEGATIVE CONSTRAINTS`) y rechaza —cayendo al
borrador— una respuesta que reproduzca el texto de una técnica no elegida en otra sección. El
borrador determinista también lleva solo las elegidas. Es una decisión deliberada que el texto
de las técnicas sea **verbatim**: son instrucciones para el generador de la página, no material
creativo, y dejar que el modelo las reescriba permitía perderlas o deformarlas sin que nada lo
detectara. Límites (la detección es literal, no semántica) y cómo se verifica, en
[`PROMPT_ENGINE.md`](PROMPT_ENGINE.md#con-el-llm-qué-se-garantiza-y-qué-no).

**Restricción heredada.** El refinamiento y las variantes **no** vuelven a llamar a
`buildPromptForProject`: leen las `sections` ya guardadas en la `prompt_version` que produjo
la Landing Page actual. Recomponerlas de nuevo costaría dos llamadas más solo para extraer
un fragmento, y como ya no es determinista, el resultado podría no coincidir con lo que
realmente generó el HTML que se está corrigiendo.

### 10. Componer el prompt es un paso explícito, no un efecto colateral de generar

**Decisión.** `composeAndPersistPrompt` (`landing-generator`) es una función nueva y separada
de `generateLanding`: hace solo los pasos 2-6 de la decisión anterior —compone el prompt, con
LLM real si aplica, y lo guarda como `prompt_version`— sin generar ningún HTML. La expone
`POST /api/prompts/compose`. `generateLanding` gana un camino nuevo: si la petición trae un
`promptVersionId` ya persistido, genera directo desde esa versión sin recomponer nada; sin
él, se comporta exactamente igual que antes (compone y genera en la misma llamada, el camino
que sigue usando cualquier otro consumidor de `POST /api/generations`).

**Motivo.** Pulsar "Generar" en el Prompt Studio componía el prompt y generaba el HTML en una
sola petición atómica: el usuario nunca veía el prompt real que un LLM había escrito —con la
Seed ya manipulada— antes de gastar la llamada de generación, la más cara en tokens y tiempo.
La única vista previa disponible (`/api/prompts/generate`) es una aproximación determinista
que nunca invoca un LLM (ver [`PROMPT_ENGINE.md`](PROMPT_ENGINE.md)); con un proveedor real,
lo que el usuario veía y lo que de verdad se enviaba al modelo podían ser distintos. Separar
los dos pasos deja revisar el prompt exacto —y decidir si generar o no— antes de comprometerse
a esa segunda llamada.

**Alternativas.** Mostrar el prompt real solo *después* de generar (no evita gastar la llamada
de generación con un prompt que el usuario no habría aprobado); mantener una sola petición
mandando el resultado intermedio en streaming (más frágil que dos endpoints independientes, y
el proyecto no usa streaming en ningún otro punto, ver "Límites conocidos" en
[`DEVELOPMENT.md`](DEVELOPMENT.md)).

**Coste.** Dos peticiones en vez de una para el camino feliz. Se acepta porque componer ya es,
la mayoría de las veces, más barato que generar (dos llamadas LLM cortas frente a una larga), y
porque evita generar HTML a partir de un prompt que el usuario podría rechazar.

**Consecuencia en la interfaz.** El Prompt Studio ya no compone un borrador gratuito al cargar
la página ni al cambiar de técnicas: el panel de prompt arranca vacío y "Generar prompt" es la
única forma de poblarlo. "Generar HTML" queda deshabilitado hasta que existe una
`prompt_version` compuesta. Si el usuario edita el texto después de componer, se crea una
versión adicional (`changeNote: 'Prompt editado manualmente en el Prompt Studio'`) ligada al
mismo `Prompt`, igual que ya hacía el camino sin `promptVersionId`.

**Dos bugs que este cambio dejó al descubierto, ya arreglados.**

1. *Las técnicas de diseño no llegaban a la composición real.* `buildPromptForProject` tenía
   `designTechniques: DEFAULT_TECHNIQUE_IDS` fijo en el código: lo que el usuario marcaba o
   desmarcaba en el Prompt Studio nunca se le pasaba. Antes de este cambio pasaba
   desapercibido porque la única vista previa (`/api/prompts/generate`) sí las respetaba;
   al dejar de llamarse automáticamente, quedó expuesto — el usuario cambiaba técnicas y el
   prompt "real" no cambiaba nunca. `buildPromptForProject` acepta ahora `designTechniques`
   como parámetro, hilado desde `composeAndPersistPrompt` hasta el Prompt Studio.
2. *La composición chocaba con su propio enfriamiento.* "Generar prompt" hace dos llamadas
   reales seguidas (Seed, luego composición) separadas por 1-2 s — menos que
   `RATE_LIMIT_COOLDOWN_MS` — así que la segunda se bloqueaba casi siempre y
   `buildPromptForProject` caía al borrador determinista **en silencio**. Detalle de la
   solución (`skipCooldown`) en
   [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md#el-enfriamiento-entre-pasos-internos-de-una-misma-acción).
   Como esa caída silenciosa podía seguir ocurriendo por otros motivos (el límite real de
   tokens/min de Groq, un timeout, un formato inválido), `BuiltPrompt` ahora lleva
   `composedByLLM: boolean` — `false` tanto en modo demo (esperado) como cuando un proveedor
   real falló y se usó el borrador (no esperado) — y el Prompt Studio avisa explícitamente en
   este segundo caso en vez de mostrar el borrador como si fuera un éxito.

### 11. Editar el HTML generado e inspeccionar la página, sin relajar el sandbox

**Decisión.** El HTML que produce el modelo se puede editar a mano en la propia aplicación y la
vista previa tiene un modo **inspector**: un clic en un elemento lleva el editor a la etiqueta de
ese elemento. Son dos piezas independientes:

1. **Guardado** — `PUT /api/landings/[id]/html` → `saveManualEdit` (`landing-generator`).
   Es un guardado real y definitivo: actualiza `landing_pages.html` **y** crea una
   `landing_version` con la etiqueta `MANUAL_EDIT_LABEL`. Reglas: solo el propietario (`403`
   también sobre páginas públicas de otra cuenta); el texto **no se normaliza** y un HTML que no
   es un documento utilizable se rechaza con `422` en vez de "arreglarse" en silencio; guardar un
   HTML idéntico no crea versión; `expectedVersion` desfasada responde `409`; la puntuación del
   crítico (`metadata.criticScore`) se invalida porque era de otro HTML. La `promptVersionId` se
   conserva, y la ficha marca la página como "editada a mano".
2. **Inspector** — `src/lib/preview/`. Un script dentro del iframe avisa al padre por
   `postMessage` de qué elemento se pulsó, y el padre lo traduce a una posición del código.

**Motivo (por qué no `allow-same-origin`).** El padre no puede leer el DOM de un iframe sin
`allow-same-origin`, y añadir ese permiso junto a `allow-scripts` deja que el documento generado
(código no confiable, decisión 6) se quite el sandbox él mismo. El inspector consigue lo mismo
sin tocar el aislamiento: corre *dentro* del iframe y solo se comunica por mensajes.

**Motivo (cómo se llega a la línea).** Se parsea el HTML con `parse5` (construye el árbol igual
que el navegador) y se inserta `data-ale-src="<posición>"` en cada etiqueta de apertura de una
**copia** del documento, por manipulación de cadena a partir de las posiciones que da el parser.
No se re-serializa el árbol (cambiaría el formato y con él las posiciones) ni se busca el
`outerHTML` dentro del texto (falla con elementos repetidos, que son casi todos).

**Contrato que hay que mantener.**

- El HTML guardado y el exportado **nunca** llevan `data-ale-src` ni el script: solo el `srcDoc`.
  Por eso `LandingPreview.html` sigue siendo el HTML limpio (es el que abre "Abrir en una pestaña
  nueva") y solo se instrumenta por dentro.
- Texto con `\n` de extremo a extremo. CodeMirror expone el documento con `\n`; si las posiciones
  se calcularan sobre un texto con `\r\n`, el salto caería desplazado una posición por línea.
- Lo que llega del iframe es **dato no confiable**: el documento generado corre en ese mismo
  iframe y puede llamar a `parent.postMessage` igual que el inspector. `parseFrameMessage` solo
  acepta el render actual (`rev`), posiciones enteras dentro del texto y cadenas acotadas.
- `inspector-runtime.ts` debe ser **autocontenido**: se incrusta con `toString()`, así que no
  puede usar nada de fuera de su cuerpo. `npm run verify:inspector` lo ejecuta en un contexto
  `vm` sin acceso al módulo, y se comprobó también sobre el build minificado de producción.
- **Guardar es explícito.** No hay autosave a la base de datos (cada guardado es una versión).
  Lo no guardado existe solo en el navegador —como borrador en `localStorage`, recuperable tras
  recargar— y el crítico, el refinamiento y las variantes se bloquean mientras haya cambios sin
  guardar, porque operan sobre la versión guardada.

**Alternativas.** `allow-same-origin` (descartada, ver arriba); buscar el elemento por
`outerHTML` o por selector (ambiguo); Monaco como editor (varios MB y *workers* en webpack;
CodeMirror 6 son ~300 KB cargados en diferido solo en las pantallas de edición).

**Coste y límites conocidos.**

- Un elemento que crea el JavaScript de la propia página no existe en el código: el inspector
  devuelve el ancestro marcado más cercano y lo indica.
- Si el HTML está minificado en una sola línea, "la línea" no ayuda: se selecciona la etiqueta y
  se muestra la columna.
- El runtime es un script en línea: si algún día se añade una CSP (hoy no hay ninguna en
  `next.config.ts`) necesitará un `nonce`.
- Un estilo incorrecto suele vivir en una regla de `<style>`, no en la etiqueta: localizar la
  regla CSS que afecta a un elemento **no está implementado**; con clases de utilidad (Tailwind
  por CDN) la etiqueta ya es el sitio correcto.
- `PATCH /api/landings/[id]` ya **no** acepta `html`: había un esqueleto que nadie usaba, guardaba
  un HTML vacío y no comprobaba el propietario. Todo el guardado de HTML pasa por la ruta nueva,
  para que las reglas de arriba no puedan esquivarse.

### 12. Imágenes generadas con IA: assets aparte, URL corta en el HTML, base64 solo al mostrar o exportar

**Decisión.** La técnica «Generación de imágenes» genera imágenes reales con FLUX.1 schnell
(Cloudflare Workers AI, capa gratuita) y las añade a la página. Las piezas:

1. **Contrato en el HTML.** El LLM deja, donde quiere una imagen, un marcador **sin `src`**:
   `<img data-ai-image="prompt en inglés" alt="…" width="1024" height="1024" loading="lazy">` (máximo 4,
   cuadrado, sin texto dentro). `src/lib/images/slots.ts` los localiza con `parse5` y los reescribe por
   **empalme de cadena** (mismo patrón que el inspector: posiciones del parser, sin re-serializar el
   árbol), así que el resto del HTML queda byte a byte igual.
2. **Paso de imágenes** (`src/services/image-generator`), entre validar y guardar
   (`runGeneration`, solo en la generación inicial): genera con concurrencia 2, guarda cada imagen
   aparte y sustituye el marcador por `src="/api/landing-images/<uuid>"`.
3. **El HTML es el estado.** Un marcador está *pendiente* si su `src` no apunta a
   `/api/landing-images/`. No hay tabla de tareas: reintentar es volver a pasar el HTML vigente por el
   mismo servicio (`POST /api/landings/[id]/images`, que crea la versión «Imagenes» solo si se generó
   alguna).
4. **No es fatal.** Sin credenciales, con la cuota agotada, sin tiempo en la petición o con una
   imagen fallida, la página se guarda igual: el marcador queda como bloque neutro y un comentario
   `<!-- IMAGEN PENDIENTE: prompt -->`. **Nunca se fabrica una imagen falsa**: sin imagen real hay un
   marcador visible como tal, igual que el modo demo se etiqueta como demo.
5. **Almacenamiento.** Tabla `landing_images` (metadatos) y los bytes aparte: `.data/images/<id>` en
   modo local, bucket **público** `landing-images` de Supabase Storage en producción. La ruta
   `GET /api/landing-images/[id]` no pide sesión: local → sirve el fichero; Supabase → `302` al bucket,
   sin consulta a BD ni clave de servicio.
6. **Presentación.** El HTML guardado nunca lleva bytes. La vista previa, las miniaturas de la
   biblioteca, «Abrir en una pestaña nueva», «Descargar HTML» y «Copiar HTML» **incrustan las
   imágenes como `data:`** en el momento (`src/lib/preview/inline-images.ts`, con caché por id).
7. **Fuera de `ProviderId` y de `generations`.** Cloudflare no es un proveedor de texto, y el enum
   `provider_id` de Postgres alimenta ~28 ficheros y los selectores. Registrar cada imagen en
   `generations` tampoco: no admite `cloudflare` como proveedor y `getDashboardStats` no filtra por
   `kind`, así que falsearía las medias de latencia. La trazabilidad vive en `landing_images`
   (prompt, modelo, latencia, generación y proyecto).

**Motivo de los assets aparte.** El HTML vive entero en `landing_pages.html` y en **cada**
`landing_versions.html`, y lo consumen el crítico (recorta a 60 000 caracteres), el refinamiento y las
variantes (lo reenvían íntegro al LLM; Groq da 413 por encima de ~8 000 tokens), el editor CodeMirror
(sin ajuste de línea), el borrador en `localStorage` y el validador (límite de 2 MB). Un base64
incrustado rompe todo eso: una imagen son cientos de KB por versión.

**Por qué la vista previa incrusta en vez de usar la URL.** Se planteó servir la URL sin sesión y
dejar que el iframe la cargara. **No funciona en desarrollo:** el iframe es un origen opaco
(decisión 6) y desde él las peticiones a `localhost` se bloquean por completo (se comprobó con
`<img>` y con `fetch` `no-cors`; en un dominio público funcionaría, pero la app se ejecuta en
`localhost`). Por eso el **padre** (mismo origen, sin restricciones) descarga las imágenes y entrega
al iframe un documento con `data:`. El `sandbox` no cambia: conceder `allow-same-origin` para evitarlo
dejaría que el HTML generado —código no confiable— se quitara el sandbox. La incrustación se aplica al
documento **ya instrumentado** por el inspector: sus posiciones `data-ale-src` son números calculados
sobre el texto original y no les afecta cambiar una URL por un `data:` dentro del `srcDoc`.

**Privacidad asumida.** La ruta es pública: el `uuid` v4 es la única capacidad de lectura. Quien
tenga la URL exacta ve esa imagen aunque la Landing Page sea privada (y en Supabase el bucket es
público). Se acepta porque son imágenes generadas por IA a partir de un prompt del LLM, la URL solo
aparece dentro del HTML de la página y ese HTML ya contiene todo lo demás. Una ruta con sesión
exigiría resolver, para cada imagen, si la página es pública o de otra cuenta.

**Tiempo.** La generación es una sola petición con `maxDuration = 120` y el LLM puede tardar 90 s:
el paso de imágenes recibe `min(45 s, 115 s − transcurrido)` y se salta si quedan menos de 10 s
(quedan marcadores y el botón «Reintentar imágenes»). No hay progreso por imagen: haría falta
streaming (ver «Límites conocidos» en [`DEVELOPMENT.md`](DEVELOPMENT.md)).

**Refinar y variar** conservan las imágenes (el LLM recibe la regla de no tocar los
`<img data-ai-image>` con su `src`) pero no generan nuevas ni regeneran. El Mock las conserva
reescribiendo la etiqueta tal cual estaba.

**Coste y límites conocidos.**

- La cuota gratuita (10 000 neuronas/día, ~173 imágenes) es de la **cuenta** de Cloudflare, no de
  un usuario; los limitadores (freno de cuota, freno de almacenamiento, imágenes por hora) viven en
  memoria de proceso. Hay reportes de 429/`4006` que persisten tras el reinicio de las 00:00 UTC: el
  freno dura 10 min y los mensajes no prometen el reinicio. Detalle en
  [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md#generación-de-imágenes-cloudflare-workers-ai).
- **Freno de almacenamiento.** Si la imagen se genera pero no se puede guardar (con Supabase: falta
  la tabla `landing_images` o el bucket porque no se ejecutó `npm run db:setup`), se abre un freno
  de 60 s para no gastar ~58 neuronas por intento en tirar la imagen, y el aviso dice qué falta.
- **Medido contra la API real (2026-09-30):** schnell devuelve **`image/jpeg` de 1024×1024**, de
  486 a 545 KB, en ~1,9 s a 4 pasos (5,7 s la primera llamada, a 1 paso). Son ~57,6 neuronas por
  imagen según la página de precios (4 teselas × 4,8 + 4 pasos × 9,6), es decir, ~173 al día. Esa
  cifra sale de los precios publicados: falta contrastarla con el panel de Cloudflare.
- No se pueden regenerar imágenes sueltas ni generar desde el editor: solo las pendientes.
- Las imágenes cuelgan del proyecto (`on delete cascade`), no de la página: una variante comparte las
  de su original y borrar una página no borra sus imágenes.
- Un elemento que crea el JavaScript de la propia página no pasa por aquí: solo se generan los
  marcadores que están en el HTML.
- La política de almacenamiento de Supabase (bucket y políticas de `storage.objects` en
  `schema.sql`/`policies.sql`) **no se ha ejecutado contra una base real**: si `db:setup` no puede
  crearla, el bucket se crea a mano (público) desde el panel. `db:check` avisa si falta.

### 13. El brief no fija estilo, estructura ni restricciones; las restricciones negativas son una técnica

**Decisión.** El asistente de proyectos tiene 3 pasos (qué, para quién, con qué tecnología). Se
eliminaron «¿Qué estilo buscas?» y «¿Qué quieres evitar?», y con ellos estilo, colores, tipografía,
sofisticación, referencias, secciones, características, beneficios y restricciones negativas del
brief. Después se quitó también del paso 3 el campo «Restricciones técnicas» (ver más abajo).
Tres reglas lo sostienen:

1. **Todo lo que sea técnica se aplica solo al elegirla.** El texto base del borrador es neutro: no
   lleva versiones parciales de ninguna técnica (`verify:prompt`, `TECHNIQUE_LEAK_MARKERS`).
2. **Las restricciones negativas son la técnica `negative-constraints-plus`.** Sin ella no existe la
   sección `NEGATIVE CONSTRAINTS`, ni el criterio de calidad #6, ni la regla 7 de la instrucción de
   sistema (`buildSystemInstruction`). La lista base (`BASE_NEGATIVE_CONSTRAINTS`) es de la técnica y
   ya no se precarga en el proyecto.
3. **Lo que el brief no fija, el borrador lo delega; no lo inventa.** Frases como «es decisión tuya»
   o «define tú la estructura» le dicen al compositor LLM que debe escribir contenido concreto, y
   sus reglas se reescribieron para eso (el modelo ya no «reescribe hechos»: crea dirección visual y
   arquitectura a partir del nicho, el público y DISCOVER).

**Motivo.** Cada uno de esos pasos predefinía una parte del prompt que las técnicas también
decidían, y el prompt se contradecía a sí mismo (medido):

| El brief fijaba | Chocaba con |
| --- | --- |
| Estilo, colores, tipografía | «Cadenas Semilla», que debe decidir la dirección creativa |
| 7 secciones por defecto | El tope de 6 de «Diseño sustractivo» |
| La restricción «sin layout genérico de SaaS: hero + tarjetas + FAQ» | Esas mismas 7 secciones por defecto |
| Diez restricciones negativas siempre presentes | «Restricciones reforzadas» y «Redacción humana», que dicen lo mismo |

Además, el texto fijo ya aplicaba versiones parciales de técnicas no elegidas (auditoría de
elementos, bucle de autorrevisión, reglas de redacción): activar o desactivar una técnica cambiaba
menos de lo que parecía, y 5 de 5 prompts compuestos por Groq traían auto-verificación sin haber
elegido «Bucles con subagentes».

**Lo que este cambio NO resuelve: la similitud entre prompts.** Medido en el borrador determinista
con dos proyectos distintos (una agenda de cerámica y una expedición de montaña), antes compartían
el 92 % de las líneas y ahora el 94 %: `VISUAL DIRECTION`, `COPY REQUIREMENTS` y la arquitectura
pasaron de texto fijo con datos por defecto a frases de delegación que también son iguales para
todos. El cambio elimina contradicciones; la variedad tiene que venir ahora del LLM compositor, que
es quien escribe esas tres secciones. No se midió con un proveedor real tras el cambio.

**Restricciones técnicas.** El paso 3 ofrecía «sin dependencias externas», «un único archivo HTML»,
«sin cookies» y «menos de 150 KB». Eran del mismo tipo que lo anterior: decisiones fijadas a mano
que chocan con lo que el usuario elige después. «Un único archivo HTML» y «menos de 150 KB» chocan
con «Generación de imágenes» (cada JPEG pesa ~500 KB y la exportación los incrusta) y con cualquier
stack que no sea HTML puro; «sin dependencias externas» choca con el CDN de Tailwind y de
Bootstrap, que el propio bloque `TECHNOLOGY` exige. Quien redacta el prompt las derivaba solo de
esa lista, y llegaban a `FUNCTIONAL REQUIREMENTS` como si fueran requisitos funcionales. Las
restricciones propias de cada tecnología siguen donde estaban (`constraints` de la tecnología, en
el bloque `TECHNOLOGY`): esas las elige el usuario al marcar la tecnología.

**Alternativas.** Mantener los pasos como opcionales (sigue habiendo choque si se rellenan); dejar
una lista de restricciones fija fuera de las técnicas (rompe «solo las técnicas elegidas»).

**Coste y límites conocidos.**

- Los campos siguen en el modelo, el esquema y Supabase como opcionales para no romper proyectos
  antiguos; si traen datos se respetan (la sofisticación solo si es distinta de 3, el valor por
  defecto del esquema; las restricciones técnicas, en `FUNCTIONAL REQUIREMENTS`). Las restricciones
  negativas propias de un proyecto antiguo solo se aplican si la técnica está elegida.
- «Framework principal» y «Librerías adicionales» siguen en el paso 3 aunque **no llegan al prompt**
  (nada los lee); su ayuda dice «se añade al contexto del prompt», y no es cierto.
- Sin estilo ni estructura en el brief, un modelo tiende a converger en lo más probable (en 4 de 4
  ejecuciones medidas, «Minimalista»). Lo mitigan la Seed (si está elegida) y las direcciones de
  DISCOVER, que ahora sí entran al prompt; no está medido con el brief nuevo ni con otros proyectos.
- DEFINE ya no inventa la arquitectura de 6 secciones ni sus 4 criterios de accesibilidad (ver «Qué
  inventaba cada fase» más abajo). Los proyectos que ya lo ejecutaron los tienen guardados: el motor
  de prompts reconoce la lista antigua y la ignora (`LEGACY_DEFINE_DEFAULT_SECTIONS`), y no añade sus
  criterios. Lo demás que DEFINE genera (`ctaStrategy`, `copyStrategy`, `visualHierarchy`,
  `styleDirection`, `responsiveCriteria`) sigue siendo texto fijo que se muestra en la ficha del
  proyecto pero **no llega al prompt**, y parte de él suena a técnica («un único elemento dominante
  por pantalla»): DEFINE queda casi decorativo.
- Con Supabase, el catálogo (sin restricciones) y las plantillas solo se actualizan al ejecutar
  `npm run db:setup` (`seed.sql` es idempotente). El modo local lo refresca solo al arrancar.
- La instrucción de sistema del catálogo (`landing-generator.system`) es solo un dato de
  referencia; la que se usa es `buildSystemInstruction`.

**Qué inventaba cada fase, y qué se hizo (medido sobre un prompt real compuesto por Groq).**

| Origen | Qué aportaba al prompt | Ahora |
| --- | --- | --- |
| Catálogo de tecnologías | 9 «Restricciones técnicas» (3 por cada HTML5, CSS3 y JavaScript), restauradas tal cual | Catálogo sin restricciones; el título no se emite vacío |
| DEFINE | Arquitectura de 6 secciones y 4 criterios de accesibilidad repetidos (la sección pasaba de 9 a 13 líneas) | No los genera; los antiguos se ignoran |
| DISCOVER | «3-5 diferenciadores concretos» aunque el brief no diera ninguno: salieron «Soporte 24/7» y «precio por transacción», presentados en `CONTEXT` como análisis previo | El sistema le prohíbe inventar cifras, integraciones, soporte y garantías, y devolver `[]` si no hay base. `CONTEXT` los presenta como hipótesis |
| Compositor | Concretó esos diferenciadores con datos que no estaban en ningún sitio («Shopify», «WooCommerce», «menos de 5 minutos») | `findInventedClaims` rechaza la respuesta y el Prompt Studio dice por qué |

El último punto se cambió de «se pide en la petición» a «se impone sobre la respuesta», que es el mismo
criterio de `reconcileComposedSections` para las técnicas no elegidas. Detalle y límites en
[`PROMPT_ENGINE.md`](PROMPT_ENGINE.md#con-el-llm-qué-se-garantiza-y-qué-no).

### 14. Las claves de los proveedores se pueden guardar desde Ajustes: por usuario, cifradas y fuera del cliente

**Decisión.** Antes las claves solo podían vivir en las variables de entorno y Ajustes no tenía
campos para escribirlas (era una decisión explícita: «las claves nunca llegan a la base de datos»).
Ahora cada usuario puede pegar las suyas en Ajustes (Gemini, Groq, URL de Ollama y Account ID y token de
Cloudflare). Esta decisión **revierte** la anterior a petición del usuario y se sostiene en cinco reglas:

1. **Por usuario, no de la app.** En un despliegue con registro abierto, una clave global editable
   dejaría que cualquier cuenta sustituyera la del dueño. La del entorno sigue existiendo como
   respaldo compartido: gana la del usuario; sin ella, la del entorno; sin ninguna, el modo demo.
2. **Cifrada en reposo** (`src/lib/credentials/crypto.ts`): AES-256-GCM, IV nuevo por mensaje y el id
   del usuario como dato autenticado (un texto cifrado copiado a otra cuenta no se descifra). La
   base de datos o `db.json` solo guardan texto cifrado; la clave maestra es `CREDENTIALS_ENCRYPTION_KEY`
   o `.data/credentials.key`, fuera de donde van las claves.
3. **Nunca vuelven al cliente.** La interfaz recibe origen y cuatro últimos caracteres; no existe
   una operación que devuelva un valor guardado. Los mensajes de error no repiten lo recibido.
4. **Lo que se guarda se valida** (`normalizeCredentialValue`): sin espacios ni saltos de línea (iría a
   una cabecera HTTP), Account ID de 32 hex, tamaños acotados.
5. **La URL de Ollama solo se cambia en modo local** (SSRF). Las demás URLs están fijas en el código.

**Qué se tocó.** `LLMProvider` y `LLMRequest` reciben las credenciales efectivas en lugar de leer
`env` (`isConfigured`, `generate`, `testConnection`, `listAvailableModels`); el orquestador las
resuelve por `ownerId`; el cliente de Cloudflare y el generador de imágenes igual. `DataStore` gana
`getCredentialsBlob`/`saveCredentialsBlob`, que solo guardan un texto opaco. En Supabase viven en
`profiles.credentials` (columna nueva, fuera de `Profile` y de `toProfile` para que no viajen con el
perfil); en local, en `db.json`.

**Alternativas.** Una clave global en un archivo del servidor (cualquier usuario la cambiaría, y no
persiste en serverless); una tabla propia (más políticas RLS y cambios en los recuentos de
`db:check`, para un solo texto por usuario); guardarlas sin cifrar (una copia de la base o de
`db.json` las expondría).

**Coste y límites conocidos.**

- `resolveCredentials` no lanza nunca: se ejecuta en cada llamada a un modelo y en cada página, y una
  base a la que le falte la columna (`db:setup` pendiente) no puede tumbar la aplicación. Cae al
  entorno y Ajustes explica por qué no se puede guardar. En Supabase supone una consulta más por
  página (deduplicada entre el layout y la página con `cache` de React).
- Si se pierde la clave maestra, las claves guardadas son irrecuperables: hay que volver a escribirlas.
- **No se ha probado contra una base de Supabase real**: se verificó el almacén local, el cifrado, la
  validación, el uso de la clave del usuario en cada proveedor y la interfaz. `SupabaseDataStore`
  (consulta a `profiles.credentials`) compila y sigue el patrón del resto, pero hay que ejecutar
  `npm run db:setup` y probarlo.
- Una clave guardada es de una cuenta de proveedor: el limitador de uso de la aplicación sigue
  siendo por usuario, pero la cuota gratuita de Gemini, Groq o Cloudflare es de esa cuenta.

---

## Manejo de errores

Un único camino: cualquier excepción se convierte en `AppError` mediante `toAppError`
(`src/lib/errors.ts`), que traduce también los `LLMError` de los proveedores.

- El mensaje es siempre apto para el usuario final («El modelo tardó demasiado en
  responder. Prueba con un prompt más corto o con otro modelo.»).
- `hint` añade una acción concreta («Revisa `GEMINI_API_KEY` en tu archivo `.env.local`»).
- `detail` es el mensaje técnico y **no se envía al cliente en producción**.
- `toHttpStatus` mapea el código a HTTP: 401, 403, 404, 422, 429, 502, 503, 504.

Estados de interfaz cubiertos: `idle`, `loading`, `success`, `error`, `empty`, `retry`.

---

## Rendimiento y coste

- **Limitador** por usuario: ventana deslizante más enfriamiento entre peticiones. Solo
  cuenta las llamadas a proveedores externos.
- **Reintento único** ante `server`, `network` o `timeout`. Nunca en bucle. La espera es
  proporcional al fallo: 5 s para un 5xx —un modelo saturado no se recupera en un segundo—
  y 1,5 s para red o timeout. Un `429` **no** se reintenta: dentro de la misma ventana de
  cuota no serviría de nada.
- **Timeout** configurable por petición, con `AbortController` real.
- **Cache** por hash de `proveedor + modelo + temperatura + system + prompt`. Se consulta
  solo cuando el usuario pide reutilizar un resultado: no se cachea de forma indiscriminada,
  porque la variación entre generaciones es parte del producto.
- **Observabilidad**: cada llamada deja proveedor, modelo, estado, latencia, tokens y
  avisos del validador en `generations`. Esa tabla nunca guarda claves (las que el usuario escribe
  en Ajustes viven aparte, cifradas: decisión 14).

Esa tabla justificó su existencia durante la integración de los proveedores reales: los
fallos del flujo se diagnosticaron leyéndola, y resultaron ser `503` y `429` del proveedor,
no defectos de la aplicación.
