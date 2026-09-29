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
npm run verify:supabase  # esquema, RLS y mappers contra la base real
```

---

## Cómo se construyó

Nueve fases, cada una verificada antes de pasar a la siguiente.

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
- `features/<dominio>/` — componentes de cliente con lógica de un dominio concreto.
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

Ya no se crea desde la interfaz: no hay catálogo. Cada ejecución genera un string aleatorio
nuevo (técnica *String Seed of Thought*) en [`seed-engine.ts`](../src/services/prompt-engine/seed-engine.ts),
y es el propio modelo que compone el prompt quien lo manipula para derivar una dirección
creativa. Detalle completo en [`SEED_ENGINE_MIGRATION.md`](SEED_ENGINE_MIGRATION.md).

### Una técnica de diseño

Añade una entrada a `DESIGN_TECHNIQUES` en
`src/services/prompt-engine/design-techniques.ts` y su id a `DesignTechniqueId`. Aparece
sola en el Prompt Studio.

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

---

## Verificación

### Recorrido de aceptación

`scripts/verify-flow.mjs` comprueba el flujo completo de punta a punta:

```bash
npm run dev          # en una terminal
npm run verify:flow  # en otra: modo demo, sin Supabase ni claves
```

Recorre crear proyecto → DISCOVER → componer prompt → generar → validar → auditar →
refinar → variante → versiones → biblioteca → reutilizar, y comprueba además el
aislamiento entre cuentas, el 401 sin sesión y el 422 ante entrada inválida. Sale con
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

### Responsive

| Ancho | Comportamiento |
| --- | --- |
| < 640 px | Una columna. Navegación en menú desplegable. Prompt y preview apilados. |
| 640–1024 px | Retículas de 2 columnas. |
| > 1024 px | Barra lateral fija. |
| > 1280 px | Prompt Studio a dos columnas: prompt \| preview. |

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
