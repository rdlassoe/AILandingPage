/**
 * Protocolo entre la vista previa (padre) y el script del inspector que corre
 * dentro del iframe. Ver `src/lib/preview/`.
 *
 * El iframe no comparte origen con la aplicacion, asi que todo viaja por
 * `postMessage`. Lo que llega del iframe es dato no confiable: el HTML generado
 * puede enviar mensajes igual que el inspector. Se valida en
 * `parseFrameMessage` antes de usarlo.
 */

/** Espacio de nombres de los mensajes; evita confundirlos con los de la propia pagina. */
export const PREVIEW_NS = 'ale' as const;

/** Un elemento de la cadena de ancestros que el inspector devuelve al hacer clic. */
export interface InspectChainItem {
  /** Posicion de su etiqueta de apertura en el HTML fuente. */
  src: number;
  tag: string;
  id: string;
  classes: string[];
}

export interface InspectHit {
  /**
   * Posicion de la etiqueta de apertura del elemento pulsado, o, si este no
   * tiene marca propia, la de su ancestro marcado mas cercano. `null` si ni
   * siquiera hay un ancestro marcado.
   */
  src: number | null;
  /** El elemento pulsado no existe en el codigo fuente (lo creo JavaScript). */
  dynamic: boolean;
  tag: string;
  id: string;
  classes: string[];
  /** Texto visible, recortado. */
  text: string;
  width: number;
  height: number;
  /** Del elemento (o su ancestro marcado) hacia arriba, solo elementos con marca. */
  chain: InspectChainItem[];
}

/** Configuracion que se incrusta en el runtime al construir el documento. */
export interface PreviewRuntimeConfig {
  /** Numero de render: descarta mensajes de un documento anterior. */
  rev: number;
  /** Posicion de scroll a restaurar tras recargar por una edicion. */
  scrollY: number;
  /** Arrancar ya con el modo inspeccion activo. */
  inspecting: boolean;
}

export type PreviewToFrame =
  | { ns: typeof PREVIEW_NS; type: 'inspect'; on: boolean }
  | { ns: typeof PREVIEW_NS; type: 'highlight'; src: number | null };

export type PreviewFromFrame =
  | { type: 'ready' }
  | { type: 'exit' }
  | { type: 'scroll'; y: number }
  | { type: 'pick'; hit: InspectHit };
