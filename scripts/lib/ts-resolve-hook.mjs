/**
 * Hook de resolucion para ejecutar modulos de `src/` con Node directamente
 * (`--experimental-strip-types`), sin pasar por Next.js:
 *
 *   - `@/algo`            -> `src/algo` (alias de tsconfig);
 *   - `./algo`            -> `./algo.ts` o `./algo/index.ts` (Node no los infiere);
 *   - `server-only`       -> modulo vacio (el paquete real lanza fuera de Next);
 *   - `@/services/llm-orchestrator` -> stub de `runLLM` que delega en
 *     `globalThis.__fakeRunLLM` (la respuesta simulada del modelo) y lanza si
 *     no hay ninguna: estos scripts nunca deben llamar a un modelo de verdad,
 *     ni gastar cuota ni tocar la red.
 *
 * Lo registra `scripts/verify-prompt-techniques.mjs` con `module.register`.
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../../src/', import.meta.url);

const EMPTY_MODULE = 'data:text/javascript,export {}';
const ORCHESTRATOR_STUB =
  'data:text/javascript,' +
  encodeURIComponent(
    [
      'export async function runLLM(request) {',
      '  const fake = globalThis.__fakeRunLLM;',
      "  if (!fake) throw new Error('runLLM sin respuesta simulada: los scripts de verificacion no llaman a un modelo real');",
      '  return fake(request);',
      '}',
      // DISCOVER usa `runLLMJson`: mismo criterio, delega en `globalThis.__fakeRunLLMJson`.
      'export async function runLLMJson(request) {',
      '  const fake = globalThis.__fakeRunLLMJson;',
      "  if (!fake) throw new Error('runLLMJson sin respuesta simulada: los scripts de verificacion no llaman a un modelo real');",
      '  return fake(request);',
      '}',
    ].join('\n'),
  );

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: EMPTY_MODULE, shortCircuit: true };
  if (specifier === '@/services/llm-orchestrator') return { url: ORCHESTRATOR_STUB, shortCircuit: true };

  let base = null;
  if (specifier.startsWith('@/')) base = new URL(specifier.slice(2), SRC);
  else if (specifier.startsWith('./') || specifier.startsWith('../')) base = new URL(specifier, context.parentURL);

  if (base) {
    for (const candidate of [base.href, `${base.href}.ts`, `${base.href}/index.ts`]) {
      if (isFile(new URL(candidate))) return nextResolve(candidate, context);
    }
  }
  return nextResolve(specifier, context);
}
