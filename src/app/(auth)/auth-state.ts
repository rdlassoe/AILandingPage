/**
 * Estado compartido de los formularios de autenticacion.
 *
 * Vive fuera de `actions.ts` porque un modulo marcado con "use server" solo
 * puede exportar funciones asincronas.
 */
export interface AuthFormState {
  error: string | null;
  notice: string | null;
}

export const EMPTY_AUTH_STATE: AuthFormState = { error: null, notice: null };
