/**
 * Normaliza la URL del proyecto de Supabase.
 *
 * El panel muestra varias URL parecidas y es facil copiar la del endpoint REST
 * (`https://xxx.supabase.co/rest/v1/`) en lugar de la del proyecto. El cliente
 * espera solo el origen, asi que se recorta aqui en vez de fallar mas tarde con
 * un 404 dificil de diagnosticar.
 *
 * Este modulo NO es `server-only`: lo usan tambien el cliente de navegador y el
 * middleware. Solo toca una variable publica, nunca un secreto.
 */
export function normalizeSupabaseUrl(value: string | undefined | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}
