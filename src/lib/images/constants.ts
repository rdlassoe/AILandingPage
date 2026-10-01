/**
 * Bucket publico de Supabase Storage donde viven los bytes de las imagenes
 * generadas (clave plana = id de la imagen). Publico a proposito: la vista
 * previa corre en un iframe sandbox sin cookies, asi que la URL, con un uuid v4
 * imposible de adivinar, es la unica capacidad de lectura. Ver
 * `supabase/schema.sql` y `docs/DATABASE.md`.
 */
export const IMAGES_BUCKET = 'landing-images';

/** Extension de fichero por MIME en el almacen local (`.data/images/<id>.<ext>`). */
export const IMAGE_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
