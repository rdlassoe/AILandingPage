# Prompt Engine

## Qué produce

Un prompt estructurado en **17 secciones canónicas**, a partir del proyecto, el stack, la
Seed String, las técnicas de diseño activas y las restricciones negativas.

`buildLandingPrompt` sigue siendo una función pura y determinista — mismo proyecto, mismo
texto — pero con un proveedor real ya no es el paso final: es el **borrador**. Dos llamadas
más al LLM lo reescriben antes de guardarlo como versión definitiva (ver
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#9-el-prompt-lo-escribe-un-llm-no-solo-el-código)):
una genera el string aleatorio de la Seed (técnica *String Seed of Thought*, sin traducirlo
a nada todavía), la otra reescribe el prompt entero — copia el stack y las restricciones tal
cual, pero **manipula el string de la Seed** para derivar de ahí la dirección creativa, en
vez de recibirla ya decidida. El **modo demo** (o un proveedor real sin configurar) se queda
en el borrador determinista, sin gastar esas dos llamadas.

```
USER INPUT
    ↓
PROJECT CONTEXT ──► DISCOVER ──► TECHNOLOGY CONTEXT (composer.ts, elegido por el usuario)
    ↓
SSoT SEED ENGINE (LLM real, o PRNG en modo demo) ──► SEED STRING
    ↓
DESIGN TECHNIQUES ──► NEGATIVE CONSTRAINTS ──► BORRADOR determinista (buildLandingPrompt)
                                                        ↓
                                    Proveedor real: LLM PROMPT COMPOSER reescribe el borrador
                                                        ↓
                                                  FINAL PROMPT
```

### Cómo se dispara desde la interfaz

`buildPromptForProject` (todo el diagrama de arriba) no se ejecuta como efecto colateral de
generar: el Prompt Studio lo expone como un paso propio. El botón **"Generar prompt"** llama
a `POST /api/prompts/compose`, que compone y persiste la `prompt_version` sin generar ningún
HTML todavía — con un proveedor real, esta es la llamada que de verdad gasta las dos peticiones
LLM (Seed + composición). Solo entonces se habilita **"Generar HTML"**, que reutiliza esa misma
`prompt_version` sin recomponerla. Detalle y motivo en
[`ARCHITECTURE.md`](ARCHITECTURE.md#10-componer-el-prompt-es-un-paso-explícito-no-un-efecto-colateral-de-generar).

Esto es distinto de `POST /api/prompts/generate`, que sigue existiendo como la vista previa
gratuita y determinista de siempre (nunca invoca un LLM, ver más abajo): el Prompt Studio ya
no la llama automáticamente al cargar la página ni al cambiar de técnicas, precisamente para
no mostrar una aproximación que se pueda confundir con el prompt real.

`POST /api/prompts/compose` recibe las técnicas activas del Prompt Studio
(`designTechniques`) y las pasa hasta `buildPromptForProject`, que a su vez las usa para
`buildLandingPrompt` en lugar del conjunto fijo por defecto. Antes de corregirlo, esta
llamada ignoraba por completo lo que el usuario marcaba o desmarcaba en el panel de técnicas
y siempre usaba las que tienen `defaultEnabled: true` — un bug real, no documentación
desactualizada: marcar o desmarcar una técnica no cambiaba nada en el prompt que de verdad se
enviaba a generar.

**Que "Generar prompt" responda 200 no significa que un LLM haya escrito el resultado.** Si
la composición falla —límite de cuota, timeout, formato inválido— `buildPromptForProject` cae
al borrador determinista como red de seguridad, y antes lo hacía sin ningún aviso: la
respuesta seguía siendo un `BuiltPrompt` válido, indistinguible de un éxito. Ahora
`BuiltPrompt.composedByLLM` distingue los dos casos (`true` solo tras una reescritura real por
LLM), y el Prompt Studio muestra un aviso y cambia el badge cuando esto ocurre con un
proveedor real y configurado — en modo demo `composedByLLM` también es `false`, pero ahí es
el comportamiento esperado y no se avisa. Detalle de por qué la segunda llamada (la
composición) es la que más a menudo fallaba en
[`LLM_PROVIDERS.md`](LLM_PROVIDERS.md#el-enfriamiento-entre-pasos-internos-de-una-misma-acción).

---

## Las 17 secciones

| # | Sección | Contenido |
| --- | --- | --- |
| 1 | `ROLE` | Director de arte + diseñador de producto + copywriter + front-end. |
| 2 | `CONTEXT` | Proyecto, tema, producto, tipo y descripción. Incluye el análisis DISCOVER si existe. |
| 3 | `OBJECTIVE` | Qué debe conseguir la página en quince segundos. |
| 4 | `TARGET AUDIENCE` | Público concreto y su *insight*. |
| 5 | `BUSINESS GOAL` | Objetivo de negocio y CTA principal. |
| 6 | `VISUAL DIRECTION` | Estilo, paleta, tipografía, sofisticación, referencias y vetos. |
| 7 | `SEED STRING` | La cadena y su traducción a decisiones de diseño. |
| 8 | `INFORMATION ARCHITECTURE` | Secciones exactas y en qué orden. |
| 9 | `COPY REQUIREMENTS` | Tono, mensaje principal, características y beneficios. |
| 10 | `TECHNOLOGY` | Bloque compuesto por el Prompt Composer. |
| 11 | `FUNCTIONAL REQUIREMENTS` | Qué tiene que funcionar de verdad. |
| 12 | `RESPONSIVE REQUIREMENTS` | Mobile-first, breakpoints, áreas táctiles. |
| 13 | `ACCESSIBILITY` | WCAG 2.1 AA, contraste, teclado, foco, etiquetas, ARIA. |
| 14 | `SUBTRACTIVE DESIGN` | Auditoría para eliminar lo que no aporta. |
| 15 | `NEGATIVE CONSTRAINTS` | Requisitos duros, no sugerencias. |
| 16 | `QUALITY CRITERIA` | Lista de verificación antes de responder. |
| 17 | `OUTPUT FORMAT` | Documento autocontenido, sin markdown, `<!DOCTYPE html>` … `</html>`. |

Las secciones vacías se omiten. El Prompt Studio permite verlas una a una antes de ejecutar.

---

## Prompt Composer: combinación de tecnologías

`src/services/prompt-engine/composer.ts`.

1. Ordena las tecnologías por `sortOrder`.
2. Detecta conflictos declarados en `conflictsWith`.
3. Resuelve por `priority`: gana la de mayor prioridad, la otra se descarta **de forma
   visible** (el conflicto viaja en el prompt y se guarda en `prompt_versions.conflicts`).
4. Concatena instrucciones, restricciones y requisitos de salida, eliminando duplicados.
5. Si alguna tecnología necesita compilación (`selfContainedPreview: false`), añade un
   bloque que exige además un HTML autocontenido equivalente para la vista previa.

Ejemplo: `Tailwind CSS` y `Bootstrap` declaran conflicto mutuo porque resuelven la misma
capa. Si se seleccionan las dos, el composer aplica la de mayor prioridad y lo dice.

Resultado: seleccionar `HTML + CSS + JS` produce un prompt distinto que
`Next.js + TypeScript + Tailwind + Lucide`, no un texto genérico con los nombres cambiados.

---

## Seed String Engine

> **Cambió de fondo respecto a versiones anteriores de este documento.** Ya no existe ningún
> catálogo de Seeds ni una traducción a directrices con un esquema fijo (`SeedDirectives`).
> La Seed **es únicamente un string aleatorio**, generado de nuevo en cada ejecución. Detalle
> completo de la migración en [`SEED_ENGINE_MIGRATION.md`](SEED_ENGINE_MIGRATION.md).

La sección `SEED STRING` del prompt existe para anclar el contexto semántico y evitar que
todas las páginas converjan hacia la misma estructura visual — pero ya no lo hace con una
cadena curada a mano. Implementa la técnica *String Seed of Thought* (Misaki & Akiba, ICLR
2026, ver el PDF en `docs/`) tal cual: alguien genera un string aleatorio, y **otro paso
distinto lo manipula** (suma de códigos + módulo, hash…) para derivar de ahí una dirección
creativa — nunca se elige la dirección directamente.

`src/services/prompt-engine/seed-engine.ts` solo hace la primera mitad:

- **`generateRandomSeedString`, con un proveedor real.** Una llamada mínima al LLM (receta del
  Listing A.5 del paper: "genera un string aleatorio complejo", sin pedirle nada más todavía).
- **`generateRandomSeedForMock`, en modo demo o sin proveedor configurado.** Lo mismo sin LLM:
  `crypto.randomBytes(24).toString('hex')`. Aleatoriedad real, no simulada.

La segunda mitad — manipular el string para derivar la dirección — la hace quien redacta el
resto del prompt, no este motor:

- **Con un proveedor real**, el propio `composePromptViaLLM` (ver más abajo) recibe el string
  dentro de la sección `SEED STRING` del borrador y la instrucción de manipularlo; escribe la
  dirección resultante ahí mismo, aplicándola también al resto de su redacción.
- **En modo demo**, `brief-parser.ts` extrae el string de la sección y lo hashea (suma de
  códigos + módulo) para elegir una de las 13 familias de estilo internas del Mock Provider
  (`SeedCategory` en `src/types/domain.ts`) — el mismo principio, hecho en código en vez de
  con razonamiento.

`renderSeedBlock(randomString)` es todo lo que queda de la función que antes traducía la Seed:
ahora solo compone el bloque `- String aleatorio: ...` más la instrucción de la técnica, sin
ningún dato precalculado.

---

## Técnicas de diseño

Las 8 de *"Tratado Práctico: 8 Técnicas Avanzadas de Diseño de Landing Pages con IA"* (PDF en
`docs/`), seleccionables y combinables desde el Prompt Studio.

| Técnica | Por defecto | Qué añade |
| --- | --- | --- |
| Cadenas Semilla (SSoT) | Sí | Obliga a que la Seed derivada por la técnica cambie decisiones concretas, no adornos. |
| Prompts Ambiciosos | No | Psicología del usuario, sesgos cognitivos, fricción a eliminar por sección — no solo estética. |
| Bucles con subagentes | No | El modelo se auto-audita bajo criterios de UX/persuasión antes de entregar su respuesta final. |
| Generación de imágenes | No | Describe cada imagen como prompt para Midjourney/DALL-E (comentario HTML), no la genera de verdad. |
| Generación de vídeo | No | Igual, para un posible vídeo de fondo — la app no integra ningún generador de vídeo. |
| Diseño sustractivo | Sí | Auditoría de cada elemento y techos duros: máx. 6 secciones, 4 tarjetas, 1 CTA primario, 3 campos por formulario. |
| Restricciones negativas reforzadas | Sí | Severidad extra sobre la sección `NEGATIVE_CONSTRAINTS` ya existente: nada de "huella de IA". |
| Redacción humana | Sí | Frases concretas, cifras, micro-copy; prohíbe los clichés de IA por nombre. |

Las dos técnicas de imagen/vídeo son deliberadamente **prompt-instrucciones, no generación
real**: la app no integra ningún modelo de imagen ni de vídeo, y fingir que sí sería simular
una integración — algo que el proyecto prohíbe explícitamente en todo lo demás.

---

## Restricciones negativas

Se inyectan como **requisitos duros**: «Estas restricciones son requisitos duros.
Incumplir una invalida la entrega.»

Por defecto un proyecto nuevo arrastra diez, editables en el paso 5 del asistente:

```
Sin degradados morados ni azul-a-violeta.
Sin el layout genérico de SaaS: hero centrado + tres tarjetas + tabla de precios + FAQ.
Sin glassmorphism ni fondos desenfocados.
Sin tarjetas con bordes muy redondeados por todas partes.
Sin sombras difusas de gran radio.
Sin animaciones de entrada en cada sección.
Sin copy genérico de IA: nada de "revoluciona", "desbloquea el poder", "lleva tu X al siguiente nivel".
Sin fotografía de stock corporativa de personas sonriendo en oficinas.
Sin emojis como sustituto de iconografía.
Sin texto de relleno tipo lorem ipsum.
```

El Critic Engine comprueba después si se han respetado, y las señala como incumplimiento
cuando no es así.

---

## Plantillas

`src/lib/data/prompt-templates.ts` define nueve plantillas almacenadas como datos, con
variables `{{nombre}}` que resuelve `renderTemplate`:

`landing-generator.system`, `discover.system`, `discover.user`, `critic.system`,
`critic.user`, `refinement.user`, `variation.user`, `technology.combination`,
`code-reviewer.user`.

Están en el DataStore, no cableadas en componentes: se pueden editar en Supabase sin tocar
el código.

---

## Critic Engine

Entrada: la Landing Page + los requisitos del proyecto + las restricciones que debían
cumplirse.

Salida:

```json
{
  "issues": [{ "id", "dimension", "severity", "title", "description", "location" }],
  "suggestions": [{ "id", "issueId", "dimension", "title", "action", "impact" }],
  "priority": ["issue-1", "…"],
  "scores": { "overall", "ux", "accessibility", "content", "code", "design" },
  "refinementPrompt": "…"
}
```

Once dimensiones: `ux`, `accessibility`, `hierarchy`, `responsive`, `clarity`,
`visual-consistency`, `cta`, `content`, `code`, `subtractive`, `generic-patterns`.

La salida del modelo **nunca se usa tal cual**: `normalizeCritique` acota dimensiones,
severidades y puntuaciones, y asigna identificadores estables. Si el modelo no aporta
sugerencias, se derivan de los problemas.

El crítico **no modifica la página**. Propone; el usuario marca qué acepta y solo entonces
se lanza el refinamiento, que produce una versión nueva conservando la anterior.

### Cuando el documento no cabe

El HTML se recorta a 60 000 caracteres antes de enviarlo. Si hay recorte, el prompt lo
**declara explícitamente**:

> AVISO: el documento se muestra recortado por longitud. Audita solo lo que ves y no
> supongas que falta lo que podría estar en la parte no mostrada.

Sin ese aviso el auditor reporta como ausentes secciones que sí estaban —un footer, un CTA
de cierre— y el usuario aplica correcciones a problemas inexistentes. Un hallazgo falso es
peor que no auditar.

---

## Prompt de refinamiento

Refinar no reenvía el encargo entero. Incrustar las 17 secciones **más** el HTML duplicaba
la petición sin aportar: el stack, la arquitectura de información y los criterios de calidad
ya están encarnados en el documento que se envía.

Solo se repiten las **siete secciones vinculantes** — el contexto mínimo para no perder el
hilo, y las restricciones que el modelo podría violar al reescribir:

| Sección | Por qué se repite |
| --- | --- |
| `CONTEXT` | Sin ella el modelo no sabe de qué va la página que está editando. |
| `TARGET_AUDIENCE` | El tono del copy nuevo debe seguir dirigiéndose al mismo público. |
| `BUSINESS_GOAL` | Para no desplazar el CTA principal. |
| `VISUAL_DIRECTION` | Evita que el refinamiento derive a otra estética. |
| `SEED_STRING` | La dirección creativa se pierde en cuanto se deja de nombrar. |
| `COPY_REQUIREMENTS` | Mantiene mensaje, características y beneficios. |
| `NEGATIVE_CONSTRAINTS` | Lo que nunca debe reaparecer al reescribir. |

Medido: **de ~10 300 a ~6 000 tokens** de entrada. La diferencia entre caber o no en el
límite por petición de una capa gratuita —Groq rechaza con `413` por encima de 8 000— y,
en todos los proveedores, menos coste y menos riesgo de truncado.

Los títulos de las cabeceras se conservan intactos porque el Mock Provider reconstruye el
brief leyéndolos: cambiarlos rompería el modo demo en silencio.

La misma condensación se aplica a la generación de variantes.

---

## El bucle completo

```
COMPOSE ──► GENERATE ──► REVIEW ──► CRITIQUE ──► (usuario acepta) ──► REFINE ──► GENERATE
```

`COMPOSE` (botón "Generar prompt") y `GENERATE` (botón "Generar HTML") son dos peticiones
separadas la primera vez — ver ["Cómo se dispara desde la interfaz"](#cómo-se-dispara-desde-la-interfaz)
más arriba. `REFINE` y la generación de variantes vuelven a fundir ambos pasos en una sola
llamada, porque parten de una `prompt_version` que ya existe (la de la Landing Page actual) y
no hay nada nuevo que revisar antes de generar.

Entre cualquier `GENERATE` y el `REVIEW` siguiente cabe un paso manual, `EDIT`: el usuario corrige
el HTML en el editor de código —con el inspector, que lleva a la línea de cada elemento— y lo
guarda como una `landing_version` más (`MANUAL_EDIT_LABEL`), sin pasar por el modelo. Desde ese
momento es el HTML vigente: el crítico lo audita y el refinamiento parte de él. No crea una
`prompt_version`, porque no hay un prompt nuevo: la versión manual conserva la del HTML del que
partió. Ver la [decisión 11](ARCHITECTURE.md#11-editar-el-html-generado-e-inspeccionar-la-página-sin-relajar-el-sandbox).

Cada vuelta crea una `prompt_version` y una `landing_version`. El historial permite
comparar y volver atrás.

Coste por vuelta, medido con modelos reales:

| Paso | Entrada | Salida |
| --- | --- | --- |
| Generación | ~3 300 | 4 800–12 100 |
| Crítica | ~4 600–4 900 | ~2 500–3 200 |
| Refinamiento | ~6 000 | ~5 600 |
| Variante | ~5 700 | ~4 600 |

Una vuelta completa ronda los 20 000 tokens de entrada. Con cuotas gratuitas conviene usar
un modelo pequeño para crítica y DISCOVER, y el grande solo para generar.
