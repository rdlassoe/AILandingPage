/**
 * Deteccion de formato y dimensiones de una imagen por sus primeros bytes.
 *
 * Lo que devuelve el proveedor de imagenes es entrada no confiable: se guarda y
 * se sirve con el `Content-Type` que se detecte AQUI (nunca el que diga el
 * proveedor o el cliente), y lo que no sea PNG, JPEG o WebP se rechaza. Las
 * dimensiones solo informan (tabla `landing_images`); no se usan para decidir
 * nada, asi que un parseo incompleto devuelve `null` y no rompe.
 *
 * Sin dependencias del proyecto para poder ejecutarlo con Node en
 * `scripts/verify-images.mjs`.
 */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface SniffedImage {
  mime: ImageMime;
  width: number | null;
  height: number | null;
}

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (isPng(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const hasHeader = bytes.length >= 24;
    return {
      mime: 'image/png',
      width: hasHeader ? view.getUint32(16) : null,
      height: hasHeader ? view.getUint32(20) : null,
    };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ...jpegSize(bytes) };
  }
  if (isWebp(bytes)) {
    return { mime: 'image/webp', ...webpSize(bytes) };
  }
  return null;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let index = offset; index < offset + length && index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index]!);
  }
  return out;
}

/** Recorre los segmentos hasta el primer SOFn, que trae alto y ancho. */
function jpegSize(bytes: Uint8Array): { width: number | null; height: number | null } {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return { width: null, height: null };
    let marker = bytes[offset + 1]!;
    // Relleno: varios 0xFF seguidos antes del marcador.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1]!;
    }
    // Marcadores sin longitud (RSTn, SOI, EOI, TEM).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > bytes.length) return { width: null, height: null };
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    if (length < 2) return { width: null, height: null };
    offset += 2 + length;
  }
  return { width: null, height: null };
}

function webpSize(bytes: Uint8Array): { width: number | null; height: number | null } {
  const kind = ascii(bytes, 12, 4);
  const unknown = { width: null, height: null };

  if (kind === 'VP8 ' && bytes.length >= 30) {
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    };
  }
  if (kind === 'VP8L' && bytes.length >= 25) {
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (kind === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
      height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
    };
  }
  return unknown;
}
