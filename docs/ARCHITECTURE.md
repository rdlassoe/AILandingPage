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
├──────────────────────────────────────────────────────────────┤
│  lib/                                                        │
│    data/  DataStore ──┬── SupabaseDataStore                  │
│                       └── LocalDataStore                     │
│    llm/   LLMProvider ┬── GeminiProvider                     │
│                       ├── GroqProvider                       │
│                       ├── OllamaProvider                     │
│                       └── MockProvider                       │
│    auth/ · validation/ · env · errors · rate-limit           │
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
  2. prompt-engine compone las 17 secciones (borrador determinista)
       · composer resuelve el stack y sus conflictos
       · SSoT Seed Engine genera el string aleatorio de la Seed
       · design-techniques inyecta las técnicas activas
  3. con proveedor real: dos llamadas LLM más reescriben el borrador
     entero (Seed + composición) — ver decisión 9
  4. guarda prompt + prompt_version  ◄── trazabilidad
        │
        ▼
El usuario revisa el prompt ya compuesto (17 secciones) en pantalla
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
  5. crea landing_page + landing_version
  6. generations(status='success', latencia, tokens, avisos)
        │
        ▼
Preview Engine: <iframe srcDoc sandbox>
        │
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
`dangerouslySetInnerHTML` para la página completa.

### 7. El refinamiento no reenvía el encargo entero

**Decisión.** Refinar y generar variantes incrustan solo siete secciones del encargo
original (`CONTEXT`, `TARGET_AUDIENCE`, `BUSINESS_GOAL`, `VISUAL_DIRECTION`, `SEED_STRING`,
`COPY_REQUIREMENTS`, `NEGATIVE_CONSTRAINTS`), no las 17.

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

### 9. El prompt lo escribe un LLM, no solo el código

**Decisión (revisada).** `buildLandingPrompt` sigue existiendo como función pura —mismo
proyecto, mismo borrador— pero con un proveedor real ya no es lo último que ocurre. Es el
**borrador**: `buildPromptForProject` (`landing-generator`) lo pasa por dos llamadas más al
LLM antes de guardarlo como versión definitiva:

1. **`generateRandomSeedString`** genera el string aleatorio de la Seed con la técnica *String
   Seed of Thought* (Misaki & Akiba, ICLR 2026) — solo eso, sin traducirlo a nada todavía.
   Se ejecuta **siempre**: la Seed ya no es una elección del proyecto ni existe un catálogo
   que consultar (ver [`SEED_ENGINE_MIGRATION.md`](SEED_ENGINE_MIGRATION.md)), así que no hay
   ninguna condición que la salte.
2. **`composePromptViaLLM`** reescribe el borrador de 17 secciones. El stack tecnológico (lo
   elige el usuario, no el LLM) y las restricciones negativas viajan como bloques que el
   modelo debe copiar tal cual. La sección `SEED STRING` es distinta a propósito: en el
   borrador solo trae el string en crudo, y es este mismo modelo quien debe **manipularlo**
   (suma + módulo, hash…) para derivar la dirección creativa y escribirla ahí — exactamente
   la mitad de la técnica que el paso anterior no hizo. El resto —contexto, objetivo,
   dirección visual, copy…— lo redacta libremente.

El **modo demo sigue siendo 100 % determinista**: usa el borrador de `buildLandingPrompt`
sin pasar por la segunda llamada, y el string de la Seed lo deriva un PRNG real
(`generateRandomSeedForMock`, `crypto.randomBytes`), no un LLM. Como no hay razonamiento que
lo manipule, `brief-parser.ts` (Mock) hashea el string en código para elegir una familia de
estilo interna. `resolveProvider` decide esto mismo que decidirá el orquestador al ejecutar
de verdad, así que un proveedor real sin configurar tampoco llega a la llamada de
composición: cae al mismo camino que el modo demo.

**Motivo.** Determinismo total facilitaba versionar y cachear por hash, pero congelaba la
redacción del encargo a lo que el código sabía escribir de antemano. Se cambia
deliberadamente: la trazabilidad no depende de poder *recalcular* el mismo prompt
ejecutando la función dos veces, sino de que cada prompt —lo redacte quien lo redacte— quede
guardado de forma inmutable en `prompt_versions`. Eso no cambia.

**Coste.** Una generación con proveedor real pasa de 1 llamada a 3 (Seed + composición +
landing), del mismo orden que ya suponía activar DISCOVER. Si el modelo no sigue el formato
de 17 secciones exigido, se cae al borrador determinista en vez de fallar: nunca se deja al
usuario sin prompt.

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
  avisos del validador en `generations`. Nunca se almacenan claves.

Esa tabla justificó su existencia durante la integración de los proveedores reales: los
fallos del flujo se diagnosticaron leyéndola, y resultaron ser `503` y `429` del proveedor,
no defectos de la aplicación.
