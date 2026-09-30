# Migración: la Seed pasa a ser solo un string aleatorio

**Estado: completo.** Código de aplicación, esquema de Supabase y scripts de verificación migrados. El `DROP` de `seed_strings`/`seed_category`/columnas de `projects` ya se aplicó contra la base real (`npm run db:setup`, ver "Qué quedaba pendiente" más abajo). Este documento se conserva como registro histórico de la migración.

> **Actualización posterior (2026-09-30): la Seed ya no se genera "siempre".** Donde este
> documento dice que `buildPromptForProject` *siempre* genera un string, léase: siempre que la
> técnica «Cadenas Semilla» (`seed-strings`) esté elegida. La Seed es una técnica de diseño más y
> el prompt lleva únicamente las que el usuario eligió, así que sin ella no hay string, ni
> sección `SEED STRING`, ni la llamada al modelo que lo generaría. `PromptBuildInput.randomSeedString`
> pasó a ser opcional (`string | null`) y `seedStringValue` queda a `null` en ese caso. Ver
> [`PROMPT_ENGINE.md`](PROMPT_ENGINE.md#seed-string-engine). Lo demás de la migración no cambia.

---

## Qué se pidió

Con el pipeline SSoT ya funcionando (ver [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md) y la sección "El prompt lo escribe un LLM" de [`ARCHITECTURE.md`](ARCHITECTURE.md)), la decisión fue ir un paso más allá:

> La Seed **no** debe ser una cadena semántica curada ("Bauhaus Funcional", con 7 directrices de composición/tipografía/color ya traducidas). Debe ser **únicamente un string aleatorio**, generado de nuevo en cada ejecución, y es quien lo recibe (el LLM que compone el prompt, o el hash determinista del Mock Provider) quien lo manipula para derivar una dirección creativa — la técnica *String Seed of Thought* tal cual la describe el paper, sin ningún paso intermedio que la traduzca a un esquema fijo de antemano.

Dos decisiones explícitas del usuario que fijaron el alcance:

1. **Se elimina también el catálogo de Seeds semánticas** (las 11 presets, el `/seeds` de la UI, `SeedDirectives`, todo) — no solo la traducción que hacía SSoT.
2. El string aleatorio se genera **solo donde hoy se usa la Seed**: en la composición del prompt (con un proveedor real, la misma llamada que reescribe el prompt genera y manipula su propio string) y en las variantes que piden explícitamente "nueva Seed".

---

## Qué se hizo (verificado: `typecheck` y `lint` limpios, `build` limpio en la última pasada completa)

### Tipos
- [`src/types/domain.ts`](../src/types/domain.ts) — eliminados `SeedDirectives` y `SeedString`. `SeedCategory` se conserva pero se redocumenta: ya no es "la categoría de una Seed elegida", es la familia de estilo interna que el Mock Provider deriva hasheando el string aleatorio. `Project.seedStringId` / `Project.seedStringValue` eliminados — el proyecto ya no persiste ninguna Seed.
  - `PromptVersion.seedStringValue`, `LandingMetadata.seedStringValue` y el campo homónimo en `Generation` **se conservan**: siguen guardando el string aleatorio real que produjo esa versión concreta, para trazabilidad. Lo que cambió es su contenido (antes podía ser una frase semántica, ahora siempre es el string aleatorio crudo), no el campo.
- [`src/types/services.ts`](../src/types/services.ts) — `SeedResolution` eliminado. `SSoTSeedResult` (label + directives + randomString + reasoning) sustituido por `RandomSeedResult { randomString, isMock }`. `PromptBuildInput.seed` / `customSeedValue` / `ssotSeed` sustituidos por `randomSeedString: string` (obligatorio, ya no opcional: siempre hay uno).

### Motor de Seed
- [`src/services/prompt-engine/seed-engine.ts`](../src/services/prompt-engine/seed-engine.ts) — reescrito por completo. Ya no existen `resolveSeed`, `inferDirectives`, `NEUTRAL_DIRECTIVES`, `generateSeedString` (el combinador de 5 ejes), ni el JSON de 7 directrices en el prompt SSoT.
  - `generateRandomSeedString(ctx)` — LLM real, receta mínima del paper (Listing A.5): "genera un string aleatorio complejo", sin pedirle que lo manipule todavía.
  - `generateRandomSeedForMock()` — `crypto.randomBytes(24).toString('hex')`, para modo demo o un proveedor real sin configurar.
  - `renderSeedBlock(randomString)` — el bloque de la sección `SEED STRING` ahora es: el string + la instrucción de aplicar la técnica (suma+módulo/hash) para derivar la dirección. Ya no incluye directrices precalculadas.

### Composición del prompt
- [`src/services/prompt-engine/llm-prompt-composer.ts`](../src/services/prompt-engine/llm-prompt-composer.ts) — `SEED_STRING` **ya no** está en `VERBATIM_SECTIONS` (antes se copiaba tal cual). Ahora el propio modelo que reescribe el prompt es quien debe manipular el string y escribir la dirección derivada en esa sección — la regla 3 del system prompt lo explicita. `VERBATIM_SECTIONS` quedó en `['TECHNOLOGY', 'NEGATIVE_CONSTRAINTS']`.

### Orquestación
- [`src/services/landing-generator/index.ts`](../src/services/landing-generator/index.ts) — `buildPromptForProject` ya no tiene la rama `hasExplicitSeed`: **siempre** genera un string aleatorio nuevo (LLM real vía `generateRandomSeedWithTracking`, que registra `generations.kind = 'seed'`; o `generateRandomSeedForMock` si el proveedor efectivo es Mock). `generateVariation` usa el mismo mecanismo para la estrategia "nueva Seed".

### Eliminado por completo (decisión del usuario de quitar también el catálogo)
- Página `/seeds`, rutas `/api/seeds` y `/api/seeds/[id]`, componente `features/seeds/seed-manager.tsx`.
- `PRESET_SEEDS` de [`src/lib/data/catalog.ts`](../src/lib/data/catalog.ts).
- Métodos `listSeeds` / `getSeed` / `createSeed` / `updateSeed` / `deleteSeed` de la interfaz `DataStore` y de **ambas** implementaciones (`local-store.ts`, `supabase-store.ts`), y sus mappers (`toSeed` / `fromSeed`) en `supabase-mappers.ts`.
- Paso "Seed String" del asistente de proyectos ([`project-wizard.tsx`](../src/features/projects/project-wizard.tsx)) y el panel "Seed String de esta ejecución" del Prompt Studio ([`prompt-studio.tsx`](../src/features/studio/prompt-studio.tsx)).
- Esquemas `createSeedSchema` / `seedDirectivesSchema` y los campos `seedStringId` / `customSeedValue` de `createProjectSchema` / `buildPromptSchema` en [`src/lib/validation/schemas.ts`](../src/lib/validation/schemas.ts).
- Enlace "Seeds" del nav ([`app-shell.tsx`](../src/components/layout/app-shell.tsx)) y del Dashboard.
- Textos de marketing/copy que mencionaban el catálogo o "tu Seed String" en `register/page.tsx`, `(auth)/layout.tsx`, `projects/page.tsx`, `landing-actions.tsx`, `projects/[id]/page.tsx`.

`GET /api/prompts/generate` (la vista previa gratuita del Prompt Studio) usa `generateRandomSeedForMock()` directamente — nunca llama a un LLM solo para previsualizar.

---

## Qué quedaba pendiente — resuelto en una sesión posterior

### 1. Esquema de Supabase — ✅ hecho, aplicado contra la base real

`supabase/schema.sql` ahora incluye el `DROP` explícito (columna → tabla → tipo, en ese orden por las dependencias de FK) que retira `seed_strings`, `seed_category` y `projects.seed_string_id` / `projects.seed_string_value` de cualquier base creada antes de esta migración. `supabase/policies.sql` ya no declara RLS ni políticas sobre `seed_strings`. Se ejecutó `npm run db:setup` contra la base real (con confirmación explícita del usuario, por ser destructivo): pasó de 15 a 14 tablas, de 8 a 7 tipos, de 26 a 22 políticas — la baja de 4 políticas es exactamente las 4 de `seeds_*` que se quitaron. `supabase/seed.sql` se regenera solo con `npm run seed:sql`, sin tocar a mano.

### 2. `scripts/generate-seed-sql.mjs` — ✅ arreglado

Ya no importa `PRESET_SEEDS` ni genera el `insert into seed_strings (...)`. Verificado con `npm run seed:sql`: genera `seed.sql` con 11 tecnologías, 9 plantillas y 17 modelos, sin errores.

### 3. `scripts/db-setup.mjs` — ✅ arreglado

`seed_strings` fuera de `EXPECTED_TABLES`, `seed_category` fuera de `EXPECTED_ENUMS`, fuera del conteo del catálogo y del umbral de políticas RLS (ajustado de 26 a 22). Verificado con `npm run db:check` contra la base real antes y después del `DROP`.

### 4. `scripts/verify-supabase.mjs` — ✅ arregladas las 4 aserciones

Se quitó `seed_strings` de la lista de tablas requeridas, el mapper `fromSeed` (ya no existe en `supabase-mappers.ts`), las columnas `seed_string_id`/`seed_string_value` del insert de prueba de `projects` y su aserción de FK, y la lectura de `seed_strings where is_preset` del test de excepciones deliberadas.

### 5. `scripts/verify-flow.mjs` — ✅ arreglada

Se quitaron `seedStringId`/`seedStringValue` del payload de creación de proyecto de prueba (campos que `createProjectSchema` ya no acepta). La aserción que buscaba la palabra "documental" en `seedStringValue` se reescribió para comprobar que hay un string aleatorio no vacío y que la sección `## SEED STRING` está presente en el prompt compuesto — lo que de verdad garantiza el nuevo modelo, no un fragmento de texto semántico que ya no existe.

### 6. Documentación restante — ✅ revisada

`docs/DEVELOPMENT.md` (tabla de fases), `docs/DATABASE.md` (diagrama ER, tipos enumerados, tabla de RLS, conteos de tablas/índices/triggers/políticas, la nota de "esquema muerto") y `README.md` (conteos y la nota de limpieza pendiente) quedaron alineados con el esquema ya limpio.

### 7. Verificación end-to-end real — ✅ hecho

`typecheck`, `lint` y `npm run seed:sql` limpios. `npm run db:check`/`db:setup` verificados contra la base real (antes y después del `DROP`). `npm run verify:flow` **no** se puede correr contra un servidor con Supabase configurado: autentica con la cookie de sesión del modo local (`als_local_session`), así que contra un servidor con Supabase real siempre da 401, sea cual sea el estado de esta migración — es una limitación de diseño del script, no un bug de la migración (`DEVELOPMENT.md` ya lo advertía: *"Probar proveedores reales sin tocar tu Supabase: levanta un segundo servidor con el almacén local"*). Se corrió como documenta ese archivo — segundo servidor en el puerto 3001 con `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` vacíos — y las 26 comprobaciones pasaron, incluida la aserción reescrita del punto 5 (`PASS  Seed String aleatoria incorporada al prompt`).

---

## Decisiones de diseño tomadas en el camino (para no repetir la discusión)

- **Por qué `PromptVersion.seedStringValue` se conserva con el mismo nombre.** Es el string aleatorio real que produjo esa versión concreta — sigue siendo "el valor de la Seed usada", solo que su contenido ya no es una frase curada. Renombrar el campo habría significado tocar la tabla `prompt_versions`/`landing_versions`/`generations` en Supabase sin necesidad: el significado (trazabilidad) no cambió, solo la fuente del valor.
- **Por qué el Mock Provider no llama a un LLM para la Seed.** `generateRandomSeedForMock()` usa `crypto.randomBytes` real (no `Math.random()` disfrazado) para mantener la promesa del modo demo: aleatoriedad genuina, cero llamadas externas, cero coste.
- **Por qué la vista previa gratuita (`/api/prompts/generate`) tampoco llama a un LLM para la Seed.** Igual que con la composición del prompt: pedirle a un LLM un string aleatorio en cada pulsación mientras el usuario ajusta técnicas gastaría cuota por nada. Usa `generateRandomSeedForMock()` siempre, sea cual sea el proveedor seleccionado en el selector — es solo una aproximación, no el resultado final.
