# Base de datos

## Puesta en marcha

Dos vías equivalentes. Las dos dejan exactamente lo mismo.

### Opción A — automática (recomendada)

```env
# .env.local
SUPABASE_DB_URL=postgresql://postgres.xxxx:TU_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

```bash
npm run db:setup
```

```
Conectado a aws-0-eu-west-1.pooler.supabase.com:5432

Aplicando el esquema

      schema.sql     tablas, tipos, indices y triggers ... hecho (412 ms)
      policies.sql   Row Level Security ... hecho (88 ms)
      seed.sql       catalogo inicial ... hecho (243 ms)

Estado de la base de datos

OK    14 tablas presentes
OK    7 tipos enumerados presentes
OK    Row Level Security activo en todas las tablas
OK    22 politicas RLS definidas
OK    Catalogo cargado: 11 tecnologias, 9 plantillas, 17 modelos

La base esta lista.
```

`npm run db:check` hace el mismo diagnóstico **sin escribir nada**, y sale con código 1 si
falta algo, así que sirve en un pipeline.

Dónde está la cadena: **Project Settings → Database → Connection string**. Sustituye
`[YOUR-PASSWORD]` por la contraseña de la base (no la clave `anon` ni la `service_role`),
**sin los corchetes**, y codifica los caracteres especiales (`@` → `%40`, `#` → `%23`).

> **Elige «Session pooler», no «Direct connection».** El host directo
> `db.<ref>.supabase.co` publica solo registro `AAAA`: es accesible **únicamente por IPv6**.
> En una red sin IPv6 el fallo llega como `ENOTFOUND`, que parece una errata en el host y no
> lo es. El pooler (`aws-0-<region>.pooler.supabase.com`) sí tiene IPv4 y su usuario lleva el
> ref del proyecto: `postgres.<project-ref>`.
>
> `npm run db:setup` detecta este caso y lo explica en lugar de dejarte con el `ENOTFOUND`.

`SUPABASE_DB_URL` la usa **solo** este script. La aplicación nunca la lee: en ejecución
habla con Supabase por la API con la clave `anon` y RLS.

El script normalmente no borra nada: aplica los tres archivos en orden, cada uno en una
transacción, de modo que si uno falla se revierte entero y te dice en qué línea. Una
migración puntual puede incluir un `DROP` explícito para retirar esquema muerto (así se hizo
al eliminar el catálogo de Seed Strings, ver
[`SEED_ENGINE_MIGRATION.md`](SEED_ENGINE_MIGRATION.md)); esos casos se documentan en el
propio `schema.sql` con un comentario que avisa de que son destructivos.

### Opción B — manual

En el **SQL Editor** de tu proyecto, en este orden:

| Orden | Archivo | Contenido |
| --- | --- | --- |
| 1 | `supabase/schema.sql` | Tipos enumerados, tablas, índices y triggers. |
| 2 | `supabase/policies.sql` | Row Level Security y políticas. |
| 3 | `supabase/seed.sql` | Catálogo: 11 tecnologías, 9 plantillas, 17 modelos. |

### Qué queda creado

| | |
| --- | --- |
| Tablas | 14 |
| Tipos enumerados | 7 |
| Índices | 41 |
| Triggers | 10 |
| Políticas RLS | 22 |

Los tres archivos son **idempotentes**: repetirlos actualiza el catálogo y deja los datos
intactos, sin duplicar filas. No requieren ninguna extensión: `gen_random_uuid()` forma
parte del núcleo de PostgreSQL desde la versión 13.

`seed.sql` está **generado** a partir de `src/lib/data/catalog.ts` y
`src/lib/data/prompt-templates.ts`. Si cambias el catálogo:

```bash
npm run seed:sql
```

Después, en `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Reinicia el servidor. La aplicación detecta Supabase y cambia de almacén; la barra lateral
lo indica («Almacenamiento: Supabase»).

---

## Modelo

```
auth.users
    │ 1:1  (trigger on_auth_user_created)
    ▼
profiles ──────────────┬──────────────┬───────────────┬──────────────┐
    │                  │              │               │              │
    ▼                  ▼              ▼               ▼              ▼
projects           prompts       landing_pages    generations   generation_reviews
    │                  │              │  ▲              │              ▲
    │                  ▼              │  │              │              │
    │           prompt_versions ──────┘  │              │              │
    │                  ▲                 │              │              │
    │                  └─────────────────┼──────────────┘              │
    │                                    │                             │
    ├──► project_technologies            ├──► landing_versions         │
    │         │                          └─────────────────────────────┘
    │         ▼
    └──► technologies        prompt_templates
         (catálogo + propias)  (catálogo)
```

### Cadena de trazabilidad

```
project → prompt → prompt_version → generation → landing_page → landing_version
```

Una Landing Page nunca queda separada de su prompt: guarda `prompt_id`,
`prompt_version_id` y `generation_id`. La ficha de la biblioteca muestra el texto exacto
que la produjo, con su Seed String, sus restricciones negativas y los conflictos de stack
que se resolvieron.

Si el HTML vigente se editó a mano (`PUT /api/landings/[id]/html`), la cadena no cambia —la
versión manual sigue apuntando a la misma `prompt_version`— pero ya no es cierto que ese prompt
produjera *exactamente* ese HTML. La ficha lo indica con la insignia "editada a mano" cuando la
versión vigente lleva la etiqueta `Edicion manual`; las versiones anteriores siguen en el
historial. Esa función **no cambió el esquema**: no hace falta volver a ejecutar `db:setup`.

---

## Tablas

> **La tabla `seed_strings`, el tipo `seed_category` y las columnas
> `projects.seed_string_id` / `projects.seed_string_value` ya no existen.** La Seed pasó a
> ser un string aleatorio generado en cada ejecución, sin catálogo (ver
> [`SEED_ENGINE_MIGRATION.md`](SEED_ENGINE_MIGRATION.md)). `supabase/schema.sql` incluye el
> `DROP` que los retiró de cualquier base que los tuviera de una versión anterior.

| Tabla | Para qué | Notas |
| --- | --- | --- |
| `profiles` | Usuario y preferencias de generación. | Se crea sola con un trigger sobre `auth.users`. |
| `technologies` | Catálogo de stacks con sus instrucciones de prompt. | `owner_id IS NULL` = catálogo común, de solo lectura. |
| `prompt_templates` | Plantillas internas del Prompt Engine. | Solo lectura desde la aplicación. |
| `landing_categories` | Catálogo de apoyo para filtros. | |
| `projects` | Brief completo. | Bloques de valor en `jsonb`. |
| `project_technologies` | Índice relacional del stack. | Permite «qué proyectos usan X». |
| `prompts` | Agrupador de versiones por proyecto. | `current_version` es el contador. |
| `prompt_versions` | Texto inmutable enviado al modelo. | `unique (prompt_id, version)`. |
| `landing_pages` | Página vigente. | `html` es el documento autocontenido. |
| `landing_versions` | Historial completo: una por generación, refinamiento y **edición manual**. | `unique (landing_page_id, version)`. Las manuales llevan `label = 'Edicion manual'` y `generation_id` nulo; conservan la `prompt_version_id` del HTML del que partieron. |
| `generations` | Observabilidad de cada llamada. | Proveedor, modelo, estado, latencia, tokens, avisos. **Nunca claves.** |
| `generation_reviews` | Salida del Critic Engine. | Issues, sugerencias, puntuaciones y prompt de refinamiento. |
| `llm_providers` / `llm_models` | Catálogo informativo. | La disponibilidad real la decide el servidor por las variables de entorno. |

### Tipos enumerados

`provider_id`, `technology_category`, `project_status`, `landing_status`,
`generation_status`, `generation_kind`, `prompt_template_kind`.

### Índices relevantes

- `projects_name_idx on ((basics ->> 'name'))` — búsqueda por nombre sin recorrer el `jsonb`.
- `landing_pages_public_idx ... where status in ('public','featured')` — índice parcial para
  la biblioteca pública.
- `generations_cache_idx on (owner_id, cache_key) where status = 'success'` — consulta de
  caché.
- Índices GIN sobre `technology_ids` y `tags` para los filtros combinables.

---

## Row Level Security

RLS está activo en **todas** las tablas. Regla general: un usuario solo ve y modifica sus
propias filas.

Excepciones deliberadas:

| Caso | Política |
| --- | --- |
| `technologies` con `owner_id IS NULL` | Lectura para cualquier usuario autenticado; sin escritura. El catálogo solo se toca con la *service role*. |
| `landing_pages` con `status in ('public','featured')` | Lectura pública. |
| `landing_versions` | Siempre privadas, aunque la página sea pública: se comparte la versión vigente, no el historial. |
| `prompt_templates`, `llm_providers`, `llm_models`, `landing_categories` | Solo lectura. |

`project_technologies` no tiene `owner_id`: hereda el permiso del proyecto mediante un
`exists` sobre `projects`.

> El código de `SupabaseDataStore` filtra además por `owner_id` en cada consulta. Es
> redundante con RLS a propósito: la intención queda explícita y una política mal aplicada
> no basta para filtrar datos.

### Comprobar el aislamiento

```bash
npm run verify:supabase
```

Valida el almacén contra tu base real: privilegios del rol `authenticated`, el trigger que
crea el perfil, el contrato de columnas de los mappers, el ida y vuelta de los bloques
`jsonb`, el aislamiento entre dos cuentas con sus excepciones deliberadas, y la integridad
referencial.

**Todo ocurre dentro de una transacción que termina en `ROLLBACK`**: no crea ni modifica
nada de forma permanente, ni siquiera los usuarios de prueba.

Cubre en particular lo que no se ve hasta producción:

| Comprobación | Por qué importa |
| --- | --- |
| Privilegios de `authenticated` | Sin `GRANT`, la app falla con *permission denied* en cada consulta aunque RLS sea perfecta. |
| Contrato de columnas | Los mappers están escritos a mano; una errata en un nombre solo se nota al guardar. |
| Ida y vuelta de `jsonb` | Confirma que ningún valor se pierde. PostgreSQL **reordena las claves**, así que comparar con `JSON.stringify` da falsos negativos. |
| Historial privado de páginas públicas | Se comparte la versión vigente, no el historial. |
| Catálogo de solo lectura | Un usuario no puede alterar `technologies` comunes. |

También puedes comprobarlo a mano con dos cuentas; la segunda no debe ver los proyectos de
la primera:

```sql
-- como usuario B
select count(*) from projects;              -- solo los suyos
select count(*) from landing_pages;         -- los suyos + los públicos
select count(*) from technologies;          -- catálogo + las suyas
```

---

## Modo local (sin Supabase)

Si faltan `NEXT_PUBLIC_SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_ANON_KEY`, la aplicación usa
`LocalDataStore`, que persiste en `./.data/db.json` con la misma interfaz.

Diferencias respecto a producción:

- No hay transacciones ni control de concurrencia.
- El aislamiento entre identidades lo aplica el propio código (`assertOwner`), no la base.
- La identidad es una cookie sin contraseña: separa espacios de trabajo, **no autentica**.
- El catálogo se refresca desde el código en cada arranque, conservando lo que haya creado
  el usuario.

`./.data` está en `.gitignore`. Para empezar de cero: para el servidor, borra la carpeta y
vuelve a arrancar (la base vive también en memoria del proceso mientras corre).
