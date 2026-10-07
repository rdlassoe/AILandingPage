# Variables de entorno

Copia `.env.example` como `.env.local`. **Todas las variables son opcionales**: sin ninguna,
la aplicación arranca con el almacén local y el modo demo.

> Next.js lee las variables al arrancar. Después de cambiar `.env.local` hay que **reiniciar
> el servidor**; no se recargan en caliente. Las claves de proveedores que escribas en **Ajustes**
> no lo necesitan: ver [«Claves guardadas desde Ajustes»](#claves-guardadas-desde-ajustes).

---

## Persistencia

| Variable | Ámbito | Por defecto | Para qué |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Cliente + servidor | vacío | URL del proyecto de Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente + servidor | vacío | Clave anónima. Es pública por diseño: la seguridad la aplica RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo servidor** | vacío | Tareas administrativas. **Salta RLS**: nunca se usa a partir de entrada del usuario. |
| `SUPABASE_DB_URL` | **Solo scripts** | vacío | Conexión directa a PostgreSQL. La usa únicamente `npm run db:setup` / `db:check`. La aplicación no la lee nunca. |

`SUPABASE_DB_URL` contiene la contraseña de la base de datos, así que tiene más alcance que
cualquier otra variable del archivo. Se usa una vez para crear el esquema y después puede
borrarse: en ejecución la aplicación habla con Supabase por la API, con la clave `anon` y
RLS. Si prefieres no escribirla, aplica los SQL a mano desde el SQL Editor (opción B en
[`DATABASE.md`](DATABASE.md)).

Supabase se considera activo solo si **URL y anon key** están presentes. Si falta cualquiera
de las dos, la aplicación usa `LocalDataStore` (`./.data/db.json`) y lo indica en la barra
lateral.

### Forzar el modo local sin tocar `.env.local`

Con claves de Supabase en `.env.local`, `npm run dev` arranca **en modo Supabase**: cuentas y
datos reales. Para ejecutar o verificar la aplicación sin tocarlos, no edites ese archivo:
Next.js da prioridad a los archivos específicos del entorno, así que basta crear uno que los
sobrescriba con valores vacíos.

| Archivo | Se lee con | Prioridad |
| --- | --- | --- |
| `.env.development.local` | `npm run dev` | sobre `.env.local` |
| `.env.production.local` | `npm run build` / `npm run start` | sobre `.env.local` |
| `.env.local` | todos | — |

```env
# .env.development.local  (temporal)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
DEFAULT_LLM_PROVIDER=mock
```

Con eso la aplicación usa el almacén local y el modo demo: no consume cuota ni crea cuentas.
Ambos nombres están cubiertos por `.env*.local` en `.gitignore`. **Bórralo al terminar**: si se
queda, tu servidor habitual también arrancará sin Supabase. Pasar las variables vacías por la
línea de comandos no funcionó de forma fiable al lanzar el servidor desde un arrancador de
procesos; esta vía sí. Más contexto en [`DEVELOPMENT.md`](DEVELOPMENT.md#contra-un-proveedor-real).

---

## Claves guardadas desde Ajustes

Las claves de los proveedores (Gemini, Groq), la URL de Ollama y las credenciales de Cloudflare
(Account ID y token) también se pueden escribir en **Ajustes**, sin editar `.env.local` ni reiniciar.

| | |
| --- | --- |
| Alcance | **Por usuario.** Cada cuenta guarda las suyas; una cuenta no ve ni usa las de otra. |
| Prioridad | La de Ajustes **gana** a la de las variables de entorno; si falta, se usa la del entorno. Con ninguna, el modo demo. |
| Almacenamiento | Cifradas con **AES-256-GCM** (IV nuevo por mensaje, el id del usuario como dato autenticado). Modo local: `.data/db.json`; Supabase: `profiles.credentials`. |
| Clave de cifrado | `CREDENTIALS_ENCRYPTION_KEY` o, si no está, `.data/credentials.key` (se crea sola, 32 bytes aleatorios, en `.gitignore`). Vive **fuera** de donde van las claves cifradas: una copia de `db.json` no basta para leerlas. |
| Hacia el cliente | Nunca. La interfaz solo recibe de dónde sale cada valor (Ajustes, entorno, ninguno) y los cuatro últimos caracteres. No existe ninguna operación que devuelva una clave. |

| Variable | Ámbito | Por defecto | Para qué |
| --- | --- | --- | --- |
| `CREDENTIALS_ENCRYPTION_KEY` | Solo servidor | vacío | Clave maestra para cifrar las claves guardadas desde Ajustes. Opcional: sin ella se genera `.data/credentials.key`. **Obligatoria** donde no se pueda escribir en disco (despliegues serverless). Si la cambias, las claves guardadas dejan de poder leerse y hay que volver a escribirlas. |

Cómo se usa:

1. Abre **Ajustes**. Cada proveedor tiene su casilla (Gemini y Groq: clave API; Ollama: URL del
   servidor; imágenes: Account ID y token de Cloudflare). Las claves se escriben ocultas y sin
   autocompletado.
2. Escribe el valor y pulsa **Guardar**. Se valida antes (sin espacios ni saltos de línea, Account ID de
   32 hex, URL de Ollama válida); si un valor no vale, no se guarda ninguno de los que mandaste.
3. Tras guardar, la casilla se vacía y muestra **de dónde sale** el valor («guardada en Ajustes», «del
   servidor (.env)» o «sin configurar») y sus cuatro últimos caracteres.
4. Pulsa **Probar conexión** para comprobarla: se prueba con lo que usaría una generación tuya (tu clave
   si la guardaste; si no, la del servidor).
5. Para quitarla, usa la papelera de la casilla: se vuelve a usar la del servidor, si hay. Para escribir
   una nueva sobre una guardada, basta con escribirla y guardar.

Límites y cosas que conviene saber:

- **La URL de Ollama solo se puede cambiar en modo local.** El servidor hace esa petición: en un
  despliegue compartido (Supabase), dejar que un usuario elija la URL permitiría que el servidor
  hable con direcciones internas (SSRF). Ahí se define con `OLLAMA_BASE_URL`. Las URLs de
  Gemini, Groq y Cloudflare están fijas en el código y no se pueden cambiar desde Ajustes.
- **Con Supabase hay que ejecutar `npm run db:setup`** para añadir la columna
  `profiles.credentials`. Hasta entonces la aplicación sigue funcionando con las claves del
  entorno y Ajustes explica que no se puede guardar. `npm run db:check` lo avisa.
- Si se pierde `.data/credentials.key` (o cambia `CREDENTIALS_ENCRYPTION_KEY`), las claves
  guardadas no se pueden descifrar: la aplicación lo dice en Ajustes, usa las del entorno y basta
  con volver a escribirlas.
- Una clave guardada en Ajustes **no** se comparte: el limitador de uso y la cuota de cada
  proveedor siguen siendo por usuario y por cuenta del proveedor, respectivamente.

---

## Proveedores LLM

| Variable | Ámbito | Por defecto | Para qué |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Solo servidor | vacío | Habilita Google Gemini. <https://aistudio.google.com/apikey> |
| `GEMINI_DEFAULT_MODEL` | Solo servidor | `gemini-flash-latest` | Modelo por defecto de Gemini. Usa el alias `-latest`: los modelos fijados se retiran y dejan de responder. |
| `GROQ_API_KEY` | Solo servidor | vacío | Habilita Groq. <https://console.groq.com/keys> |
| `GROQ_DEFAULT_MODEL` | Solo servidor | `openai/gpt-oss-120b` | Modelo por defecto de Groq. |
| `OLLAMA_BASE_URL` | Solo servidor | `http://localhost:11434` | Servidor de [Ollama](https://ollama.com/download). No requiere clave: corre en local. |
| `OLLAMA_DEFAULT_MODEL` | Solo servidor | `qwen3:8b` | Modelo por defecto de Ollama. Debe estar descargado (`ollama pull <modelo>`). |
| `DEFAULT_LLM_PROVIDER` | Solo servidor | `mock` | Proveedor preseleccionado: `mock`, `gemini`, `groq` u `ollama`. |

Si se selecciona un proveedor sin clave, la aplicación degrada al modo demo y lo avisa: no
falla.

### Sobre los modelos

El catálogo de [`src/lib/llm/models.ts`](../src/lib/llm/models.ts) se verificó **llamando a
cada modelo**, no solo listando el endpoint de modelos. La diferencia importa: en Gemini,
la familia 2.5 sigue apareciendo en `GET /v1beta/models` pero responde
`404 no longer available`; en Groq, los modelos Llama desaparecieron del todo. Si añades uno
nuevo, pruébalo de verdad antes de fiarte del listado.

Un modelo que no esté en el catálogo **sigue siendo utilizable**: simplemente no se acota su
`maxOutputTokens` y es la API quien valida.

**Usa los alias `-latest` cuando el proveedor los ofrezca.** Los identificadores fijados se
retiran; un alias no requiere mantenimiento.

Dos respuestas que conviene reconocer:

| Código | Significado | Qué hacer |
| --- | --- | --- |
| `503` | *Ese modelo* está saturado. Transitorio y frecuente en los recién salidos. | Reintentar, o elegir un modelo algo más antiguo. |
| `429` | Cuota agotada para ese modelo. | Esperar o cambiar de modelo. Groq envía `retry-after` y la app dice cuántos segundos. |

### Cuotas de las capas gratuitas

Generar una Landing Page consume del orden de **3,5 K tokens de entrada y hasta 12 K de
salida**, y tarda entre 20 y 72 segundos.

| Proveedor | Límite que se nota primero | Efecto práctico |
| --- | --- | --- |
| Gemini | Cuota diaria por modelo | Tres generaciones seguidas con un Flash la agotan (`429`). |
| Groq | **8 000 tokens por minuto y por petición** | Espaciar ~1 min entre pasos. Y una sola petición por encima de 8 000 da `413`: auditar una página de más de ~20 KB no cabe. |
| Ollama | Ninguna cuota; el límite es el hardware | Sin clave ni ventana de tiempo, pero un modelo local en CPU puede tardar bastante más que 72 s. El modo demo y Ollama son los únicos exentos del limitador de uso ([`ARCHITECTURE.md`](ARCHITECTURE.md)). |

Reparte el trabajo: un modelo `-lite` o pequeño para DISCOVER y para las críticas, y el
modelo grande solo para generar. Se elige por ejecución en el Prompt Studio.

`LLM_TIMEOUT_MS` vale 90 s por algo: se midieron generaciones de 72 s. No lo bajes salvo que
tu plataforma de despliegue te obligue; si generas con Ollama en una máquina lenta, súbelo en
lugar de bajarlo.

---

## Generación de imágenes (Cloudflare Workers AI)

Opcional. La usa la técnica de diseño «Generación de imágenes»: el LLM deja marcadores
`<img data-ai-image="…">` y el servidor los rellena con FLUX. **No es un proveedor de texto**: no
se elige en el Prompt Studio ni compite con Gemini o Groq, y funciona con cualquiera de ellos (también
con el modo demo). Sin las dos primeras credenciales —ni en variables de entorno ni guardadas en
**Ajustes**—, la técnica deja los marcadores con la descripción de cada imagen y el Prompt Studio lo
avisa. La URL de la API y el modelo son solo del servidor: no se cambian desde Ajustes. Detalle, límites y errores en
[`LLM_PROVIDERS.md`](LLM_PROVIDERS.md#generación-de-imágenes-cloudflare-workers-ai).

| Variable | Ámbito | Por defecto | Para qué |
| --- | --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Solo servidor | vacío | Account ID del panel de Cloudflare. |
| `CLOUDFLARE_API_TOKEN` | Solo servidor | vacío | Token con permisos *Workers AI – Read* y *Edit*. Se activa solo con cuenta **y** token. |
| `CLOUDFLARE_IMAGE_MODEL` | Solo servidor | `@cf/black-forest-labs/flux-1-schnell` | Modelo. Solo admite los de entrada JSON; FLUX.2 usa multipart y no está soportado. |
| `IMAGE_MAX_PER_LANDING` | Solo servidor | `4` | Marcadores que se generan por página (tope 8); el resto queda pendiente. |
| `IMAGE_STEPS` | Solo servidor | `4` | Pasos de difusión de schnell (máximo 8). |
| `IMAGE_TIMEOUT_MS` | Solo servidor | `30000` | Tiempo máximo **por imagen**. |
| `IMAGE_STEP_BUDGET_MS` | Solo servidor | `45000` | Tiempo máximo de **todo** el paso de imágenes de una generación. |
| `IMAGE_RATE_LIMIT_PER_HOUR` | Solo servidor | `30` | Imágenes por usuario y hora (limitador en memoria, cubo propio). |
| `IMAGE_QUOTA_COOLDOWN_MS` | Solo servidor | `600000` | Tras un 429 de cuota agotada, no se vuelve a llamar a Cloudflare durante este tiempo. |
| `IMAGE_STORAGE_COOLDOWN_MS` | Solo servidor | `60000` | Tras no poder **guardar** una imagen recién generada (falta el esquema de Supabase, políticas…), no se vuelve a llamar a Cloudflare durante este tiempo: cada intento gastaría neuronas en vano. |
| `CLOUDFLARE_API_BASE_URL` | Solo servidor | API oficial | **Solo para pruebas** (`scripts/stub-cloudflare.mjs`). Se ignora si no es `https` ni `http://localhost`: el token nunca debe viajar en claro a otro host. |

Cuota de la capa gratuita: **10 000 neuronas al día**, con reinicio a las 00:00 UTC. Cloudflare
no documenta la resolución de salida de schnell; medida con `npm run verify:cloudflare`
(2026-09-30) es un **JPEG de 1024×1024** de ~500 KB. A 4 pasos son ~57,6 neuronas por imagen según
la página de precios (4 teselas de 512² × 4,8 + 4 pasos × 9,6), es decir, **~173 imágenes al día**
(~43 páginas con 4 imágenes). Es una estimación de los precios publicados: contrástala con el panel
de Cloudflare (Workers AI → Usage).

---

## Límites y tiempos

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `LLM_TIMEOUT_MS` | `90000` | Tiempo máximo por petición al modelo. Generar una landing con un modelo grande puede tardar 30–60 s. |
| `RATE_LIMIT_MAX_REQUESTS` | `20` | Peticiones a proveedores externos por usuario y ventana. |
| `RATE_LIMIT_WINDOW_MS` | `3600000` | Duración de la ventana deslizante (1 h). |
| `RATE_LIMIT_COOLDOWN_MS` | `3000` | Enfriamiento mínimo entre peticiones del mismo usuario. |

El modo demo no cuenta para el límite: no consume cuota de ningún servicio.

---

## Cómo se leen

`src/lib/env.ts` centraliza la lectura y está marcado como `server-only`. Si un componente
de cliente lo importara, **el build falla** en lugar de filtrar una clave al navegador.

```ts
import 'server-only';

export const env = {
  supabase: { url, anonKey, serviceRoleKey, enabled },
  gemini:   { apiKey, defaultModel, baseUrl },
  groq:     { apiKey, defaultModel, baseUrl },
  ollama:   { baseUrl, defaultModel },
  llm:      { defaultProvider, timeoutMs },
  cloudflare:{ accountId, apiToken, model, baseUrl, enabled },   // del entorno: respaldo de lo guardado en Ajustes
  credentials:{ encryptionKey },
  images:   { maxPerLanding, steps, timeoutMs, stepBudgetMs, ratePerHour, quotaCooldownMs, storageCooldownMs, maxBytes },
  rateLimit:{ maxRequests, windowMs, cooldownMs },
} as const;
```

**Orden de declaración.** `env` se evalúa entera al importar el módulo, así que cualquier
constante que use una función llamada desde el objeto (`CLOUDFLARE_DEFAULT_BASE_URL`) debe
declararse **antes** de `export const env`. Una `const` posterior compila y pasa `tsc`, pero al
arrancar sin la variable da `Cannot access 'x' before initialization` —lo destapó `npm run build`—.
`npm run verify:images` lo comprueba arrancando `env.ts` con y sin variables.

Lo único que viaja al cliente es `getRuntimeConfigSummary(credentials)`, que no contiene secretos. Recibe
las credenciales **efectivas del usuario** (Ajustes + entorno) y no solo el entorno: para quien guardó su
propia clave, el proveedor aparece como configurado aunque `.env.local` esté vacío:

```ts
{
  supabaseEnabled: boolean;
  storageMode: 'supabase' | 'local';
  defaultProvider: ProviderId;
  providersConfigured: { mock: true, gemini: boolean, groq: boolean, ollama: true };
  imageGeneration: { provider: 'cloudflare', configured: boolean, model: string, maxPerLanding: number };
  timeoutMs: number;
  rateLimit: { maxRequests, windowMs, cooldownMs };
}
```

---

## Seguridad

- `.env`, `.env.local` y variantes, y `.data/` (con `credentials.key`), están en `.gitignore`.
  **Nunca** se suben claves.
- Solo las variables con prefijo `NEXT_PUBLIC_` llegan al navegador. Ninguna clave de
  proveedor lo lleva. Se comprobó sobre el bundle compilado: ninguna de las claves del servidor
  aparece en `.next/static`.
- Las claves **escritas en Ajustes** sí se guardan, pero **cifradas** (ver «Claves guardadas
  desde Ajustes») y por usuario, y no vuelven al navegador ni aparecen en los registros:
  `generations` almacena proveedor, modelo, estado, latencia y tokens, nunca credenciales. Un
  valor mal formado se rechaza antes de guardarlo (sin espacios ni saltos de línea: acabaría en
  una cabecera HTTP) y el mensaje de error nunca repite lo recibido.
- Si crees que una clave se ha filtrado, revócala en el panel del proveedor y genera otra:
  rotarla es más rápido que auditar dónde ha quedado.

---

## Despliegue

En Vercel, Netlify o equivalente, define las mismas variables en el panel del proyecto.
Marca como *secret* todas menos las `NEXT_PUBLIC_*`.

**Claves de proveedores guardadas desde Ajustes.** En un despliegue sin disco escribible
(Vercel, Netlify) no se puede crear `.data/credentials.key`: define `CREDENTIALS_ENCRYPTION_KEY` con 32 o más
caracteres aleatorios, marcada como *secret*, o Ajustes avisará de que no se pueden guardar claves. Con
Supabase, ejecuta antes `npm run db:setup` (añade `profiles.credentials`). Si cambias la clave
de cifrado, las claves ya guardadas dejan de poder leerse y cada usuario debe escribirlas de nuevo.

Las rutas de generación declaran `maxDuration = 120`. Si tu plan limita la duración de las
funciones por debajo de eso, baja `LLM_TIMEOUT_MS` en consecuencia para que el error que vea
el usuario sea el de la aplicación («El modelo tardó demasiado en responder») y no un 504
opaco de la plataforma.
