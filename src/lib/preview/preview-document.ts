import { inspectorRuntime } from './inspector-runtime';
import { injectRuntime, instrumentHtml, type SourceMap } from './instrument';
import type { PreviewRuntimeConfig } from '@/types/preview';

/**
 * Documento que realmente se carga en el iframe cuando el inspector esta
 * disponible: el HTML con una marca de posicion en cada etiqueta y el script
 * del inspector. Es una copia: el HTML guardado y el que se exporta no la
 * llevan.
 */
export async function buildPreviewDocument(
  html: string,
  config: PreviewRuntimeConfig,
): Promise<{ srcDoc: string; map: SourceMap }> {
  const { html: marked, map } = await instrumentHtml(html);
  const runtime = `(${inspectorRuntime.toString()})(${JSON.stringify(config)});`;
  return { srcDoc: injectRuntime(marked, runtime), map };
}
