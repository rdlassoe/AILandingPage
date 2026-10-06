# Plan de mejora: prompt con proveedor real y proyectos multi-archivo

**Estado: PAUSADO por el usuario (2026-10-06); no se implementó nada de la Fase 3. La Fase 1 (brief de 3 pasos) y parte de la Fase 2 se hicieron después por otra vía: ver la decisión 13 de `ARCHITECTURE.md`.** Alcance: solo la creación del prompt con un
proveedor LLM real y lo mínimo que hace falta para que ese prompt sirva. El modo demo (`mock`) no se
rediseña: sigue produciendo un HTML único y se etiqueta como tal.

Decisiones ya tomadas por el usuario:

1. **Next.js debe funcionar desde el principio**, incluida la vista previa.
2. **Todo lo que hoy es `selfContainedPreview = false` es «proyecto»**: TypeScript, React, Next.js,
   Vue y Astro.
3. **El brief se queda en 3 pasos** (los dos últimos —«¿Qué estilo buscas?» y «¿Qué quieres
   evitar?»— se eliminan porque chocan con las técnicas).

---

## 1. Qué se validó (y cómo)

Todo se comprobó ejecutando los módulos reales, sin llamar a ningún modelo salvo lo que ya estaba
guardado en `.data/db.json`.

### 1.1 React o Next terminan siempre en un único HTML

Cuatro capas lo imponen, ninguna depende del modelo:

| Capa | Dónde | Qué hace |
| --- | --- | --- |
| Instrucción de sistema | `DEFAULT_SYSTEM_INSTRUCTION` (`prompt-engine/sections.ts`) | Igual para cualquier stack: «devuelves UNICAMENTE código, la primera línea es `<!DOCTYPE html>`». Se guarda en la `prompt_version`. |
| Bloque `TECHNOLOGY` | `composer.ts` + catálogo | El asistente preselecciona `html5`, `css3`, `javascript`; sus `outputRequirements` («un único documento HTML», «CSS embebido», «JS embebido, sin dependencias») se mezclan con las de React/Next. `conflicts = 0`: nada lo avisa. Se restaura verbatim, el LLM no puede corregirlo. |
| `OUTPUT FORMAT` | `prompt-engine/index.ts` | Se contradice: «devuelve primero el código del stack» y, dos líneas después, «la respuesta empieza por `<!DOCTYPE html>`, sin texto antes». El LLM lo copia sin cambios (similitud 1,00 en 5 ejecuciones). |
| Validador y datos | `output-validator/index.ts`, `LandingPage.html: string` | Solo existe un `html`. Con tres respuestas simuladas de un proyecto completo: (a) árbol + un bloque ``` por archivo → guarda **el árbol** como si fuera la página y la generación queda `invalid_output`; (b) solo `tsx`/`json` → guarda `json {"name":"faro"}`; (c) separadores de texto + HTML → sobrevive el HTML y los archivos se pierden con un simple aviso `conversational_wrapper`. |

Conclusión: aunque el modelo obedeciera al 100 %, el sistema descartaría el proyecto.

### 1.2 Pasos 4 y 5 del brief chocan con las técnicas

| Campo | Choca con |
| --- | --- |
| Estilo, colores, tipografía (4) | «Cadenas Semilla», que debe decidir justo eso. El prompt no dice quién manda. |
| Sofisticación, referencias (4) | Nada las contrasta con el estilo escrito. |
| 10 restricciones por defecto (5) | «Restricciones reforzadas» y «Redacción humana» (triple redundancia). |
| «Sin layout genérico de SaaS: hero + tarjetas + FAQ» (5) | Las secciones por defecto son exactamente ese layout, y superan el tope de 6 de «Diseño sustractivo» (7 secciones). |
| Secciones, características, beneficios (5) | «Diseño sustractivo» (máx. 6 secciones y 4 tarjetas). |

20 archivos leen esos campos; seguirán existiendo en el modelo como opcionales para no romper
proyectos antiguos.

### 1.3 Por qué los prompts con LLM se parecen (datos reales, 1 proyecto, 5 composiciones)

- El 61 % del texto final no cambia: las 3 secciones que el código restaura (`TECHNOLOGY`,
  `SUBTRACTIVE DESIGN`, `NEGATIVE CONSTRAINTS`) más `FUNCTIONAL`, `ACCESSIBILITY`, `OUTPUT FORMAT`,
  `QUALITY` y `RESPONSIVE`, que el modelo copia casi idénticas.
- `CONTEXT` queda en 0,84 de parecido con el borrador: paráfrasis del brief.
- Con estilo, colores y tipografía vacíos, las 4 ejecuciones donde el modelo escribió un «Estilo»
  dijeron «Minimalista».
- **6 de 11 composiciones fallaron** (2 por el enfriamiento entre pasos, 4 por el 429 de tokens por
  minuto de Groq) y devolvieron el borrador determinista: más de la mitad de los «prompts del LLM»
  son el borrador.
- La «manipulación» de la Seed no es fiable: en 3 de 5 ejecuciones el cálculo que escribe el modelo
  no coincide con la suma real del string (p. ej. declara 13 274; la real es 3 837).

**Límite de estas medidas:** un solo proyecto. No hay datos de similitud entre proyectos distintos
con LLM.

---

## 2. Diseño del modo «proyecto»

### 2.1 Resolución de entrega

Función pura `resolveDelivery(effectiveTechnologies)`:

| Stack efectivo | Entrega |
| --- | --- |
| Solo `html5`/`css3`/`javascript`/`tailwindcss`/`bootstrap`/`lucide` | `html` (como hoy) |
| `nextjs` | `project` · plantilla `next` |
| `astro` (sin `nextjs`) | `project` · plantilla `astro` |
| `vue` | `project` · plantilla `vite-vue` |
| `react` (sin `nextjs`) | `project` · plantilla `vite-react` |
| `typescript` | Modificador: `.tsx`/`.ts` sobre la plantilla elegida |

Prioridad `nextjs` > `astro` > `vue` > `react`. En modo proyecto, las tecnologías «base» de HTML
único (`html5`, `css3`, `javascript`) **no aportan** sus requisitos de salida ni sus restricciones al
bloque `TECHNOLOGY`. Los conflictos se declaran también entre `javascript` y los frameworks.

### 2.2 Andamio del sistema + archivos del LLM

El LLM **no escribe** `package.json`, `tsconfig`, configuración de Next/Vite/Tailwind. Los pone el
sistema, con versiones fijas y una lista cerrada de dependencias (`next`, `react`, `react-dom`,
`typescript`, `tailwindcss`, `@tailwindcss/postcss`, `lucide-react`, `clsx`; el resto, a decidir).
El LLM entrega solo los archivos de código, en rutas permitidas (Next: `app/**`, `components/**`,
`lib/**`; Vite: `src/**`).

Motivos: la vista previa arranca siempre, hay muchos menos tokens de salida, no se pueden colar
dependencias arbitrarias y el prompt se centra en diseño y contenido.

Protocolo de salida, tolerante a fences de markdown dentro del bloque:

```
<<<FILE path="app/page.tsx">>>
…código…
<<<END FILE>>>
```

### 2.3 Validación previa al arranque

Parser propio, separado del validador HTML (`output-validator` no se toca):

- rutas relativas, sin `..`, dentro de las carpetas permitidas; máx. de archivos y de tamaño;
- existe el archivo de entrada de la plantilla;
- cada `import` relativo resuelve a un archivo entregado y cada import de paquete está en la lista
  cerrada;
- Next: aviso si un archivo usa hooks o eventos sin `"use client"`;
- el resultado es `files: {path, content}[]` más avisos; errores bloqueantes → `invalid_output`.

### 2.4 Compositor y prompt

- Cuando hay entrega `project`: instrucción de sistema y `OUTPUT FORMAT` propios (protocolo de
  archivos, sin «HTML equivalente»), y `OUTPUT FORMAT` pasa a la lista de secciones verbatim.
- La instrucción de sistema por modo se guarda en la `prompt_version`: las versiones antiguas no
  cambian.
- «Generación de imágenes» queda **desactivada con motivo visible** en modo proyecto en la v1 (el
  parser de marcadores trabaja sobre HTML con `parse5`, no sobre JSX).

### 2.5 Almacenamiento

`files jsonb` y `delivery text` (`html` | `project`) en `landing_pages` y `landing_versions`
(migración en `supabase/schema.sql`, idempotente; ampliación de `LocalDataStore` y de los mappers).
En modo proyecto, `html` guarda un documento estático generado (título y lista de archivos) para que
la biblioteca, las miniaturas y el crítico actual sigan funcionando sin cambios.

### 2.6 Vista previa de Next.js: WebContainers

Es la única opción evaluada que ejecuta **Next.js real** en el navegador del usuario. Las otras
(Sandpack con Nodebox, compilar en el servidor) quedan como alternativa si el spike falla.

Lo comprobado en la documentación (no en este proyecto):

- Next.js figura entre los frameworks que soporta WebContainer API.
- **Requiere aislamiento de origen cruzado** en el documento raíz: `Cross-Origin-Opener-Policy:
  same-origin` y `Cross-Origin-Embedder-Policy` (`require-corp`, o `credentialless` solo en
  Chromium). Solo se puede aplicar a una **ruta dedicada de nivel superior**, no a toda la app: el
  resto de páginas incrustan imágenes externas y el Studio usa iframes.
- Soporte completo en Chrome y navegadores Chromium; Firefox y Safari (16.4+) en beta, con
  limitaciones para recursos de terceros. Fuera de Chromium se mostrará el código y el ZIP, sin
  vista previa.
- Depende de proxies alojados por StackBlitz y de que `npm install` tenga red.
- **Licencia:** la licencia comercial se exige para uso en producción con fines de lucro; el
  prototipado y las pruebas de concepto están exentos, y el uso debe cumplir sus Términos de
  Servicio. Para este proyecto académico es aceptable; si se comercializa, hay que contratarla.
- Turbopack no funciona con los bindings WASM de SWC (documentación de Next.js). **Inferencia sin
  comprobar:** WebContainer cae a esos bindings, así que la plantilla de Next usará
  `next dev --webpack` y una versión de Next fijada (la propia app usa 15.5.4).

**No verificado y por eso es la primera tarea (spike):** tiempo de arranque, memoria, que
App Router + Tailwind v4 + `lucide-react` compilen dentro del WebContainer y que el aislamiento no
rompa nada de la app.

### 2.7 Salida y descarga

Vista de archivos (árbol + visor de solo lectura con CodeMirror, lenguaje por extensión) y descarga
en ZIP que incluye el andamio, de modo que el proyecto se ejecuta con `npm install && npm run dev`.

### 2.8 Proveedores

El modo proyecto necesita salida grande: se avisa (y se bloquea si el proveedor lo declara
insuficiente) con Groq gratuito (8 000 tokens por minuto). Gemini es el objetivo; Ollama depende del
modelo y del hardware.

---

## 3. Fases

Cada fase termina con `typecheck`, `lint` y su verificación; la fase 3 además con `npm run build`
(sin servidor de desarrollo levantado, ver `DEVELOPMENT.md`).

### Fase 0 · Spike de WebContainers con Next.js *(puerta de entrada)*

En una rama aparte. Una ruta desechable, con COOP/COEP solo ahí, monta a mano un andamio de Next
fijado y mide: arranque (`server-ready`), memoria, que App Router, Tailwind v4 y `lucide-react`
funcionen, y que el resto de la app siga igual.

- **Criterio de paso:** el servidor de Next arranca y se ve en el iframe en un tiempo razonable en
  Chrome/Edge del usuario (objetivo orientativo: < 2 min la primera vez).
- **Si no pasa:** se vuelve al usuario con alternativas antes de seguir (vista previa solo para
  Vite y código para Next; o compilación en servidor solo en desarrollo).

### Fase 1 · Brief de 3 pasos
- Quitar los pasos 4 y 5 del asistente; campos opcionales con valores por defecto en el esquema.
- Paso 3: de la lista de 11 casillas a un **tipo de entrega** (HTML único · React · Next.js · Vue ·
  Astro) más extras (Tailwind, Lucide, TypeScript). El tipo rellena `technologyIds`; no cambia el
  esquema. Desaparece la preselección de `html5`/`css3`/`javascript` en proyectos.
- Ajustar `verify-flow`, `verify-supabase` y `verify-prompt-techniques`.

### Fase 2 · Quién aporta lo que se quitó
- **Dirección visual:** la escribe el compositor con la Seed (si está elegida), `visualDirections` de
  DISCOVER (hoy se genera y no entra al prompt) y una instrucción explícita de no caer en
  «minimalista» por defecto.
- **Arquitectura:** propuesta por el compositor según tipo de landing y fricciones, con tope de 6
  secciones si «Diseño sustractivo» está elegida. Se acaba el 100 % fijo de `DEFAULT_SECTIONS`.
- **Características y beneficios:** derivados de la descripción; regla de no inventar cifras ni
  testimonios (hoy el prompt dice «todos los números y plazos son reales y verificables» sin que el
  brief traiga datos).
- **Restricciones negativas:** la lista base pasa a ser el texto de «Restricciones reforzadas»
  (fuente única). La sección `NEGATIVE CONSTRAINTS` deja de existir siempre: existe solo con esa
  técnica.
- **Fiabilidad del compositor:** reintento ante 429 respetando `retry-after`; que el fallo al
  borrador se vea en la interfaz y no cuente como éxito.

### Fase 3 · Modo proyecto
- 3a `resolveDelivery`, andamios y supresión de las tecnologías base en el bloque `TECHNOLOGY`.
- 3b Prompt: instrucción de sistema y `OUTPUT FORMAT` por modo; compositor.
- 3c Parser y validador de proyecto.
- 3d Almacenamiento (`files`, `delivery`) y migración.
- 3e Vista de archivos y ZIP.
- 3f Vista previa con WebContainers (ruta dedicada con COOP/COEP; para Vite y Next).

### Fase 4 · Iterar sobre un proyecto
- Refinamiento y variantes sobre archivos: el modelo devuelve solo los archivos modificados con el
  mismo protocolo; el resto no cambia.
- Crítico sobre código TSX (solo con proveedor real; el crítico estático del demo es de HTML).
- Reparación con LLM a partir del error de compilación que muestra el WebContainer.
- Edición manual de archivos (reutiliza CodeMirror).

---

## 4. Verificación

- `npm run verify:project-output` (sin servidor ni claves): parser y validador con respuestas
  simuladas: fences, marcador de cierre ausente, `..` en rutas, paquete fuera de lista, entrada
  ausente, límites de tamaño, imports sin resolver.
- `verify:prompt` ampliado: matriz de resolución de entrega para todas las combinaciones de
  `nextjs`/`astro`/`vue`/`react`/`typescript` y comprobación de que ningún bloque de un modo
  menciona instrucciones del otro (p. ej. «único documento HTML» en modo proyecto).
- Spike y vista previa: comprobación manual en navegador (no automatizable de forma fiable, ver
  `DEVELOPMENT.md`).
- Una prueba real con Gemini para un proyecto Next, con el resultado anotado aquí.

## 5. Riesgos conocidos

- WebContainers: licencia comercial, dependencia de los proxies de StackBlitz, solo Chromium con
  garantías, y consumo de memoria y tiempo de arranque sin medir.
- Un modelo puede ignorar el protocolo de archivos: el parser debe fallar con un mensaje claro, no
  guardar basura (hoy el validador HTML sí la guarda).
- Los proyectos son varias veces más grandes que un HTML: coste, latencia y límites de los
  proveedores gratuitos.
- «Generación de imágenes» y el inspector HTML no existen en modo proyecto en la v1.

## 6. Documentación a actualizar al terminar

`ARCHITECTURE.md` (decisión nueva y flujo de generación), `PROMPT_ENGINE.md` (entrega por modo,
secciones, técnicas), `DATABASE.md` (columnas nuevas), `DEVELOPMENT.md` (verificaciones y límites),
`ENVIRONMENT.md` (cabeceras de aislamiento y nota de licencia).
