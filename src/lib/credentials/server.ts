import 'server-only';

import { cache } from 'react';

import { getCredentialsStatus, resolveCredentials } from './index';
import { getDataStore } from '@/lib/data';

/**
 * Para paginas y layouts. `cache` de React hace que el layout y la pagina que lo cuelga lean
 * las credenciales UNA vez por renderizado (en Supabase cada lectura es una consulta mas). No
 * se usa en rutas ni en servicios, que ya tienen su `store` y no se renderizan dos veces.
 */
export const getUserCredentials = cache(async (userId: string) => resolveCredentials(await getDataStore(), userId));

export const getUserCredentialsStatus = cache(async (userId: string) =>
  getCredentialsStatus(await getDataStore(), userId),
);
