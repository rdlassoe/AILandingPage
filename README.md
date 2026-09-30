# AI Landing Studio

Plataforma de ingeniería de prompts para diseñar, generar, auditar, refinar y versionar
Landing Pages con modelos de lenguaje.

No es un generador de `prompt → HTML`. El recorrido completo es:

```
IDEA → DISCOVER → DEFINE → PROMPT ENGINEERING → COMPOSICIÓN DE TECNOLOGÍAS →
ORQUESTACIÓN LLM → GENERACIÓN → VALIDACIÓN → CRÍTICA → REFINAMIENTO →
PREVIEW → VERSIONADO → BIBLIOTECA
```

---

## Arranque rápido

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>, entra con cualquier correo y ya puedes recorrer el flujo
completo. **No hace falta configurar nada**: sin claves de API la aplicación usa el
*Mock Provider* y sin Supabase guarda los datos en `./.data/db.json`.

Todo lo generado en ese modo aparece etiquetado como **demo** en la interfaz, en la base
de datos y en los metadatos del HTML. Nunca se atribuye una salida del modo demo a Gemini,
Groq ni Ollama.

---

## Qué hace

| Módulo | Responsabilidad |
| --- | --- |
| **Dashboard** | Estado del sistema, atajos y observabilidad de las últimas ejecuciones. |
| **Project Builder** | Asistente de 5 pasos: qué, para quién, con qué stack, con qué estilo, qué evitar. |
| **Discover / Define** | Análisis del encargo (nicho, público, fricciones) y derivación de la arquitectura de información. |
| **Technology Manager** | Las tecnologías son datos: cada una aporta instrucciones, restricciones y requisitos de salida al prompt. |
| **Seed String Engine** | Genera un string aleatorio en cada ejecución (técnica *String Seed of Thought*); no hay catálogo, lo manipula el propio modelo para derivar una dirección creativa. |
| **Prompt Engine** | Ensambla un prompt de 17 secciones canónicas de forma determinista. |
| **Prompt Composer** | Combina varias tecnologías, detecta conflictos y resuelve prioridades. |
| **LLM Orchestrator** | Punto único de contacto con los modelos: proveedor, modelo, timeout, reintento único, límite de uso. |
| **Output Validator** | Normaliza y valida la respuesta antes de mostrarla. No se confía en el modelo. |
| **Preview Engine** | `iframe` + `srcDoc` con sandbox de origen opaco. Con el inspector activo, un clic en un elemento lleva el editor a su línea. |
| **Code Editor** | Edita el HTML generado a mano (CodeMirror) y lo guarda como una versión nueva. Guardar es explícito; lo no guardado es un borrador local. |
| **Critic Engine** | Agente crítico que audita UX, accesibilidad, jerarquía, responsive, CTA, copy y código. |
| **Refinement** | Regenera aplicando solo las recomendaciones que el usuario acepta. |
| **Landing Library** | Banco de páginas con versiones, filtros, prompt asociado y reutilización. |

---

## Requisitos

- Node.js ≥ 20.9 (probado en 24)
- npm ≥ 10

Opcionales:

- Un proyecto de [Supabase](https://supabase.com) (capa gratuita) para autenticación real y
  persistencia compartida.
- Una clave de [Gemini](https://aistudio.google.com/apikey) o de
  [Groq](https://console.groq.com/keys), ambas con capa gratuita — o [Ollama](https://ollama.com/download)
  instalado en local, sin clave ni cuota.

---

## Configuración

### 1. Variables de entorno

```bash
cp .env.example .env.local
```

Todas las variables son opcionales. Ver [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) para el
detalle de cada una.

```env
# Persistencia (si se dejan vacías se usa el almacén local en ./.data)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Proveedores LLM (si se dejan vacías se usa el modo demo)
GEMINI_API_KEY=
GROQ_API_KEY=
OLLAMA_BASE_URL=
DEFAULT_LLM_PROVIDER=mock
```

> Las claves `*_API_KEY` solo se leen en el servidor. `src/lib/env.ts` está marcado como
> `server-only`: si un componente de cliente lo importara por error, el build fallaría en
> lugar de filtrar la clave al navegador.

### 2. Supabase (opcional)

**Automático.** Añade la cadena de conexión a `.env.local` y ejecuta un comando:

```env
SUPABASE_DB_URL=postgresql://postgres.xxxx:TU_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

```bash
npm run db:setup    # crea tablas, políticas RLS y catálogo
npm run db:check    # comprueba el estado sin escribir nada
```

La cadena está en **Project Settings → Database → Connection string → URI**. Sustituye
`[YOUR-PASSWORD]` por la contraseña de la base de datos (no es la clave `anon` ni la
`service_role`) y codifica los caracteres especiales para URL. `SUPABASE_DB_URL` solo la
usa ese script: la aplicación no la necesita.

**Manual.** Si prefieres no dar la contraseña de la base a un script, pega en el
**SQL Editor** de Supabase, en este orden:

1. `supabase/schema.sql` — tipos, tablas, índices y triggers.
2. `supabase/policies.sql` — Row Level Security.
3. `supabase/seed.sql` — catálogo inicial.

Ambas vías dejan lo mismo: **14 tablas, 7 tipos enumerados, 41 índices, 10 triggers y
22 políticas RLS**, más 11 tecnologías, 9 plantillas y 17 modelos. Los
scripts son idempotentes: repetirlos no duplica nada.

Después, rellena `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, reinicia el
servidor y la aplicación cambiará de almacén sin tocar una línea de interfaz. Detalle en
[`docs/DATABASE.md`](docs/DATABASE.md).

`supabase/seed.sql` es un archivo **generado**. Si cambias el catálogo en
`src/lib/data/`, regenéralo:

```bash
npm run seed:sql
```

### 3. Proveedores de IA (opcional)

```env
GEMINI_API_KEY=...
GEMINI_DEFAULT_MODEL=gemini-flash-latest

GROQ_API_KEY=...
GROQ_DEFAULT_MODEL=openai/gpt-oss-120b

# Sin clave: instala Ollama, descarga un modelo (`ollama pull qwen3:8b`) y
# dejalo vacio para usar http://localhost:11434.
OLLAMA_BASE_URL=
OLLAMA_DEFAULT_MODEL=qwen3:8b

DEFAULT_LLM_PROVIDER=gemini
```

Reinicia y comprueba el estado en **Ajustes → Modelos de IA**, donde puedes lanzar una
prueba de conexión real. Para verificar el flujo entero contra el modelo:

```bash
npm run verify:flow -- --provider=gemini
npm run verify:flow -- --provider=groq
npm run verify:flow -- --provider=ollama
```

> **Usa los alias `-latest` cuando existan.** Los identificadores fijados se retiran: la
> familia `gemini-2.5-*` y los `llama-*` de Groq dejaron de responder durante el desarrollo
> de este proyecto. Ollama no tiene ese problema porque el catálogo se lee en caliente de los
> modelos instalados, pero sí comparte con Gemini 3.x el gasto de tokens en razonamiento
> (modelos `thinking` como `qwen3`). Detalle y cuotas en
> [`docs/LLM_PROVIDERS.md`](docs/LLM_PROVIDERS.md).

---

## Flujo de trabajo

1. **Proyectos → Nuevo proyecto.** Cinco pasos; solo los dos primeros son obligatorios.
2. **Ejecutar DISCOVER** en la ficha del proyecto. Analiza el encargo y deriva la
   arquitectura de información.
3. **Prompt Studio → Generar prompt.** El Prompt Engine compone el prompt real (con LLM si
   hay proveedor configurado) con el brief, el stack, un string aleatorio nuevo (Seed String,
   técnica SSoT) y las técnicas de diseño activas, y lo persiste. Puedes revisarlo o editarlo
   antes de generar.
4. **Generar HTML.** Reutiliza ese mismo prompt ya compuesto (no lo recompone). El
   orquestador elige proveedor y modelo, el validador normaliza la salida y la vista previa la
   renderiza en un `iframe` aislado.
5. **Editar (opcional).** En la pestaña "Codigo" del Prompt Studio, o en `/library/[id]/edit`,
   corriges el HTML a mano. Con "Inspeccionar" haces clic en un elemento de la vista previa y
   el editor salta a su etiqueta. `Ctrl+S` guarda una versión nueva ("Edicion manual"); hasta
   entonces el crítico y el refinamiento no ven tus cambios.
6. **Auditar.** El Critic Engine devuelve problemas puntuados y acciones concretas.
7. **Refinar.** Marcas las recomendaciones que aceptas; se genera una versión nueva.
8. **Publicar.** La página queda en la biblioteca con su prompt, su versión y su historial.
9. **Reutilizar.** Desde cualquier página puedes clonar su planteamiento a un proyecto nuevo.

---

## Estructura

```
src/
├── app/                      Rutas (App Router)
│   ├── (auth)/               Login y registro
│   ├── (workspace)/          Área privada: dashboard, proyectos, studio, biblioteca…
│   └── api/                  Route handlers
├── components/
│   ├── ui/                   Kit de interfaz sin estado
│   ├── layout/               Shell, navegación, búsqueda global
│   ├── preview/              Preview Engine (iframe + srcDoc, modo inspector)
│   └── editor/               Editor de código CodeMirror (carga diferida)
├── features/                 Componentes con lógica por dominio
│   ├── projects/  studio/  library/  technologies/  settings/
│   └── editor/               Estado de edición, sincronía editor ↔ inspector, pantalla de edición
├── lib/
│   ├── auth/                 Sesión (Supabase Auth o identidad local)
│   ├── data/                 DataStore: interfaz + Supabase + local
│   ├── llm/                  LLM Provider Layer (mock, gemini, groq, ollama, registro)
│   ├── preview/              Instrumentación del HTML (parse5) y runtime del inspector
│   ├── validation/           Esquemas Zod
│   └── utils/  env.ts  errors.ts  rate-limit.ts  api-client.ts
├── services/                 Lógica de negocio pura
│   ├── prompt-engine/        Composición, Seed Engine, técnicas de diseño
│   ├── llm-orchestrator/     Proveedor, timeout, reintento, cache
│   ├── output-validator/     Normalización y validación del HTML
│   ├── landing-generator/    Flujo completo de generación y versionado
│   ├── critic-engine/        Auditoría y prompt de refinamiento
│   └── discover-engine/      Fases DISCOVER y DEFINE
├── types/                    Contratos TypeScript
└── middleware.ts             Refresco de sesión de Supabase
```

Arquitectura y decisiones en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## API interna

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `GET/POST` | `/api/projects` | Lista y crea proyectos. |
| `GET/PATCH/DELETE` | `/api/projects/[id]` | Ficha de proyecto. |
| `POST` | `/api/prompts/generate` | Vista previa gratuita y determinista del prompt, **sin LLM**. |
| `POST` | `/api/prompts/compose` | Compone el prompt real (con LLM si aplica) y lo persiste, **sin generar HTML**. |
| `GET/POST` | `/api/generations` | Historial y generación de Landing Page (reutiliza un prompt ya compuesto si se le pasa `promptVersionId`). |
| `POST` | `/api/generations/critique` | Ejecuta el Critic Engine. |
| `POST` | `/api/generations/refine` | Regenera aplicando las mejoras aceptadas. |
| `POST` | `/api/generations/variation` | Crea una variante como página independiente. |
| `POST` | `/api/discover` | Fase DISCOVER + derivación de DEFINE. |
| `GET` | `/api/landings` | Biblioteca con filtros combinables. |
| `GET/PATCH/DELETE` | `/api/landings/[id]` | Ficha de Landing Page (nombre, estado, categoría; el HTML no se cambia por aquí). |
| `PUT` | `/api/landings/[id]/html` | Guarda el HTML editado a mano como versión nueva y vigente. `422` si no es un documento, `409` si la versión base está desfasada, `403` si la página es de otra cuenta. |
| `GET` | `/api/landings/[id]/versions` | Historial de versiones. |
| `POST` | `/api/landings/[id]/reuse` | Clona el planteamiento a un proyecto nuevo. |
| `GET/POST` | `/api/technologies` | Catálogo y alta de tecnologías propias. |
| `GET` | `/api/providers` | Estado de los proveedores (sin secretos). |
| `POST` | `/api/providers/test` | Prueba de conexión real (512 tokens de salida). |
| `GET` | `/api/search` | Búsqueda global. |

Todas devuelven `{ data }` o `{ error: { code, message, hint } }`. El detalle técnico no
viaja al cliente en producción.

---

## Comandos

```bash
npm run dev         # servidor de desarrollo
npm run build       # build de producción
npm run start       # servir el build
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run db:setup    # crear el esquema en Supabase (necesita SUPABASE_DB_URL)
npm run db:check    # diagnosticar el estado de la base, sin escribir
npm run verify:supabase # validar esquema, RLS y mappers (transacción + rollback)
npm run seed:sql    # regenerar supabase/seed.sql desde el catálogo
npm run verify:flow # recorrido de aceptación de punta a punta (con el server arrancado)
npm run verify:inspector # instrumentación del inspector y mensajes del iframe (sin servidor)
```

---

## Seguridad

- Las claves de API solo existen en el servidor; no llegan al navegador, ni a la base de
  datos, ni a los logs.
- Las llamadas a proveedores se hacen exclusivamente desde route handlers.
- La vista previa se renderiza en un `iframe` con `sandbox="allow-scripts allow-forms
  allow-popups allow-modals"`. Al **no** incluir `allow-same-origin`, el documento generado
  corre en un origen opaco: puede ejecutar su propio JavaScript pero no leer cookies,
  `localStorage` ni tocar la ventana padre. No se usa `dangerouslySetInnerHTML`.
- El inspector no relaja ese aislamiento: un script dentro del iframe avisa por `postMessage` y
  el padre trata cada mensaje como dato no confiable (solo acepta el render actual, posiciones
  dentro del texto y cadenas acotadas). Las marcas del inspector viven solo en una copia del
  documento: el HTML guardado y el que se exporta no las llevan.
- Con Supabase, el aislamiento entre cuentas lo aplica Row Level Security; el código filtra
  además por `owner_id` para que la intención sea explícita.
- Toda entrada HTTP se valida con Zod antes de llegar al almacén o a un proveedor.
- Limitador de uso por usuario con ventana deslizante y enfriamiento. Solo cuenta las
  llamadas a proveedores externos: el modo demo y Ollama (local) no consumen cuota de nadie.

---

## Troubleshooting

**«Ningún proveedor de IA configurado: estás en modo demo»**
Es el comportamiento esperado sin claves. Añade `GEMINI_API_KEY` o `GROQ_API_KEY` en
`.env.local` y reinicia el servidor (Next.js no recarga las variables en caliente) — o instala
[Ollama](https://ollama.com/download) y descarga un modelo, que no necesita clave.

**«La clave API del proveedor no es válida o ha caducado»**
Comprueba la clave en Ajustes → *Probar conexión*. El mensaje de error incluye el estado
HTTP devuelto por el proveedor en modo desarrollo.

**«El modelo devolvió una respuesta que no pudimos interpretar»**
El Output Validator rechazó la salida. Suele ocurrir con modelos de ventana de salida corta:
elige uno marcado como apto para salida larga, o reduce el número de secciones del proyecto.

**«El modelo agotó el presupuesto de salida razonando»**
Los modelos Gemini 3.x, y en Ollama la familia `qwen3` (modelos "thinking"), gastan parte del
presupuesto de salida pensando antes de escribir. Si `maxOutputTokens` es pequeño, devuelven
texto vacío con un 200 OK. Sube el presupuesto o cambia de modelo.

**«No se pudo contactar con Ollama en http://localhost:11434»**
Ollama no está arrancado, o `OLLAMA_BASE_URL` apunta a otro sitio. Arráncalo y comprueba que
el modelo está descargado con `ollama list`.

**«Ese modelo está saturado» (503)**
Le pasa a los modelos recién salidos. No es un fallo del servicio: elige uno algo más
antiguo (`gemini-3.5-flash` en lugar de `gemini-flash-latest`) o reintenta.

**«La petición supera el tamaño máximo que admite ese modelo» (413)**
Distinto de un 429: no es ritmo, es tamaño de una sola petición, y **reintentar no sirve**.
Le pasa a Groq en capa gratuita, que tope cada petición a 8000 tokens. Reduce el número de
secciones del proyecto, o audita y refina con Gemini y deja Groq para generar.

**«Cuota agotada» (429)**
Gemini limita por día y por modelo; Groq, a 8 000 tokens por minuto en capa gratuita. Una
generación consume ~7 400, así que auditar justo después falla: espera un minuto o usa un
modelo distinto para la auditoría.

**Un modelo que existe en el panel devuelve 404**
Fue retirado. Listar modelos no garantiza que respondan: revisa el catálogo de
`src/lib/llm/models.ts` y prueba el modelo con una llamada real.

**«Has alcanzado el límite de N generaciones por hora»**
Ajusta `RATE_LIMIT_MAX_REQUESTS` o espera a que la ventana se deslice.

**«El prompt no lo compuso el LLM» (badge "borrador (sin LLM)" en el Prompt Studio)**
"Generar prompt" pidió a un proveedor real componer el prompt, pero falló (cuota agotada,
timeout, formato inválido) y se usó el borrador determinista como red de seguridad — sigue
siendo un prompt válido, solo que sin la Seed aplicada por el modelo. Pulsa "Generar prompt"
de nuevo; si vuelve a pasar seguido con Groq, es su límite real de 8 000 tokens/min, espera
~1 minuto entre intentos.

**«Recuperamos cambios sin guardar» al abrir el editor**
Cerraste o recargaste la pestaña con cambios sin guardar: el editor los guarda como borrador
local en el navegador y los restaura. Siguen sin formar parte de la página hasta que pulses
Guardar (o los descartes con "Descartarlos"). El crítico y el refinamiento no los ven.

**«La página cambió mientras la editabas» (409)**
Otra acción —un refinamiento, otra pestaña— creó una versión nueva mientras editabas. "Cargar
la ultima" descarta tu texto; "Conservar mi texto" lo deja listo para guardarse como la versión
siguiente y la anterior sigue en el historial.

**«No se puede guardar este HTML» (422)**
El guardado manual no "arregla" el documento: lo rechaza si no hay `<html>`/`<body>`, si pesa
más de 2 MB o es demasiado corto. Corrígelo en el editor. Los avisos no bloqueantes (sin `lang`,
sin `<h1>`, sin viewport…) se muestran tras guardar, pero no impiden el guardado.

**El botón "Inspeccionar" está desactivado, o el clic no salta a la línea**
Desactivado: el inspector no pudo cargarse (`parse5` es una descarga diferida) o no hay página
que previsualizar. Sin salto: si escribiste hace un instante, la vista previa aún se estaba
actualizando con tus cambios; el panel del inspector muestra un aviso y no se salta, para no
caer en otra línea. Espera un momento y vuelve a pulsar. Un elemento que crea el JavaScript de
la página no está en el código y se muestra su ancestro más cercano.

**Los datos del modo local no se borran**
`LocalDataStore` mantiene la base en memoria del proceso. Para empezar de cero: para el
servidor, borra `./.data` y vuelve a arrancar.

**Errores de Supabase al guardar**
Ejecuta `npm run db:check`: te dice qué falta (tablas, enums, RLS, políticas o catálogo). Un
`storage_error` con código `42501` significa que falta una política.

**`npm run db:setup` no conecta (`ENOTFOUND`)**
Casi siempre es esto: el host de **conexión directa** `db.<ref>.supabase.co` solo tiene
dirección IPv6. Si tu red no tiene IPv6, no resuelve. Usa la cadena del **Session pooler**
(`aws-0-<region>.pooler.supabase.com`, usuario `postgres.<project-ref>`), que sí tiene IPv4.
El script lo detecta y te lo dice.

Si el error es de autenticación, revisa que la contraseña no conserve los corchetes de la
plantilla `[YOUR-PASSWORD]` y que los caracteres especiales estén codificados para URL.

---

## Documentación

| Documento | Contenido |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Capas, flujo de datos y decisiones arquitectónicas. |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Modelo de datos, relaciones y RLS. |
| [`docs/LLM_PROVIDERS.md`](docs/LLM_PROVIDERS.md) | Capa de proveedores y cómo añadir uno nuevo. |
| [`docs/PROMPT_ENGINE.md`](docs/PROMPT_ENGINE.md) | Las 17 secciones, el motor de Seed String y técnicas de diseño. |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Convenciones, fases de construcción y checklist de QA. |
| [`docs/SEED_ENGINE_MIGRATION.md`](docs/SEED_ENGINE_MIGRATION.md) | Estado de la migración del catálogo de Seeds al string aleatorio. |
| [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) | Todas las variables de entorno. |

---

## Estado conocido

- El almacén local (`./.data`) es para desarrollo y evaluación: no tiene transacciones ni
  concurrencia. Producción = Supabase + RLS.
- El limitador de uso vive en memoria del proceso. Con varias instancias habría que moverlo
  a Redis o a una tabla; la interfaz del módulo no cambiaría.
- En modo local no hay contraseñas: el correo solo separa espacios de trabajo en el equipo.
  La autenticación real es Supabase Auth.
- Con claves de Supabase en `.env.local`, `npm run dev` usa Supabase. Para probar en modo local
  sin tocar tus datos, ver [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md#forzar-el-modo-local-sin-tocar-envlocal).
- Editor de código: no localiza la regla CSS que afecta a un elemento (solo su etiqueta) y no hay
  pantalla para restaurar o comparar versiones. Verificado a 360 px en claro y oscuro y, en el
  Studio, también a 768, 1024 y 1440 px; lo que falta por medir está en
  [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#responsive-y-modo-oscuro-del-editor).
- `npm audit` reporta vulnerabilidades en `next@15.5.4`, fijado en `package.json` desde antes
  del editor. Pendiente de actualizar a una 15.x parcheada.
