# Prompt Engine

## Qué produce

Un prompt estructurado en **17 secciones canónicas**, ensambladas de forma determinista a
partir del proyecto, el stack, la Seed String, las técnicas de diseño activas y las
restricciones negativas.

`buildLandingPrompt` es una función pura: el mismo proyecto produce siempre el mismo texto.
Eso es lo que permite versionarlo, cachear por hash y distinguir los cambios del usuario de
los del sistema.

```
USER INPUT
    ↓
PROJECT CONTEXT ──► DISCOVER ──► SEED STRING ──► TECHNOLOGY CONTEXT
    ↓                                                   ↓
DESIGN TECHNIQUES ──► NEGATIVE CONSTRAINTS ──► PROMPT COMPOSER
                                                        ↓
                                                  FINAL PROMPT
```

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

## Seed String Engine (SSoT)

Una Seed String ancla el contexto semántico para evitar que todas las páginas converjan
hacia la misma estructura visual.

No es texto decorativo: cada Seed se traduce a **siete directrices concretas** que viajan al
prompt.

```ts
interface SeedDirectives {
  composition: string;   // retícula, alineaciones, tensión
  typography: string;    // familias, escala, interlineado
  color: string;         // paleta y uso del acento
  hierarchy: string;     // cómo se construyen los niveles
  spacing: string;       // ritmo vertical y densidad
  imagery: string;       // qué tipo de imagen y para qué
  components: string;    // radios, bordes, sombras, botones
}
```

El catálogo incluye 11 Seeds (Swiss Editorial, Bauhaus Funcional, Laboratorio Industrial,
Tecnología Documental, Lujo Editorial, Arquitectura Mínima, Retro Computing, Brutalismo Web,
Tecnología Orgánica, Revista Contemporánea, Retícula Experimental) y el usuario puede crear
las suyas.

Si se escribe una Seed a mano, `inferDirectives` deduce la categoría por palabras clave y
reutiliza las directrices de esa familia.

### Generación diversa

Para las variantes con estrategia *«mismo contenido, nueva Seed String»* o *«experimental»*,
`generateSeedString()` compone una cadena interna combinando cinco ejes semánticos
(movimiento, materia, disciplina, tensión, luz).

> Es una **estrategia de diversificación creativa**, no un generador criptográficamente
> seguro. La cadena interna no se muestra al usuario salvo que la pida.

---

## Técnicas de diseño

Se activan y desactivan desde el Prompt Studio; cada una inyecta un bloque de instrucciones.

| Técnica | Por defecto | Qué añade |
| --- | --- | --- |
| Diseño sustractivo | Sí | Auditoría de cada elemento y techos duros: máx. 6 secciones, 4 tarjetas, 1 CTA primario, 3 campos por formulario. |
| Redacción humana | Sí | Frases concretas, cifras, micro-copy; prohíbe los clichés de IA por nombre. |
| Jerarquía visual explícita | Sí | Una idea dominante por pantalla; jerarquía por tamaño y espacio. |
| Anclaje de Seed String | Sí | Obliga a que la Seed cambie decisiones concretas, no adornos. |
| Revelación progresiva | No | Lo imprescindible primero; el detalle bajo demanda y accesible. |
| Prueba social honesta | No | Evidencia verificable; prohíbe inventar empresas y testimonios. |
| Micro-copy funcional | No | Texto de apoyo junto a cada acción y mensajes de error útiles. |
| Presupuesto de rendimiento | No | < 150 KB, sin librerías ni fuentes remotas. |

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
GENERATE ──► REVIEW ──► CRITIQUE ──► (usuario acepta) ──► REFINE ──► GENERATE
```

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
