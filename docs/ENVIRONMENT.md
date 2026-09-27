# Variables de entorno

Copia `.env.example` como `.env.local`. **Todas las variables son opcionales**: sin ninguna,
la aplicación arranca con el almacén local y el modo demo.

> Next.js lee las variables al arrancar. Después de cambiar `.env.local` hay que **reiniciar
> el servidor**; no se recargan en caliente.

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
  llm:      { defaultProvider, timeoutMs },
  rateLimit:{ maxRequests, windowMs, cooldownMs },
} as const;
```

Lo único que viaja al cliente es `getRuntimeConfigSummary()`, que no contiene secretos:

```ts
{
  supabaseEnabled: boolean;
  storageMode: 'supabase' | 'local';
  defaultProvider: ProviderId;
  providersConfigured: { mock: true, gemini: boolean, groq: boolean };
  timeoutMs: number;
  rateLimit: { maxRequests, windowMs, cooldownMs };
}
```

---

## Seguridad

- `.env`, `.env.local` y variantes están en `.gitignore`. **Nunca** se suben claves.
- Solo las variables con prefijo `NEXT_PUBLIC_` llegan al navegador. Ninguna clave de
  proveedor lo lleva.
- Las claves no se guardan en la base de datos ni aparecen en los registros: `generations`
  almacena proveedor, modelo, estado, latencia y tokens, nunca credenciales.
- Si crees que una clave se ha filtrado, revócala en el panel del proveedor y genera otra:
  rotarla es más rápido que auditar dónde ha quedado.

---

## Despliegue

En Vercel, Netlify o equivalente, define las mismas variables en el panel del proyecto.
Marca como *secret* todas menos las `NEXT_PUBLIC_*`.

Las rutas de generación declaran `maxDuration = 120`. Si tu plan limita la duración de las
funciones por debajo de eso, baja `LLM_TIMEOUT_MS` en consecuencia para que el error que vea
el usuario sea el de la aplicación («El modelo tardó demasiado en responder») y no un 504
opaco de la plataforma.
