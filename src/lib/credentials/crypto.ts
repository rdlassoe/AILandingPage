import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { env } from '@/lib/env';

/**
 * Cifrado de las credenciales que el usuario guarda desde Ajustes.
 *
 * AES-256-GCM con un IV nuevo por mensaje y el identificador del usuario como dato
 * autenticado (AAD): el texto cifrado de una cuenta no se puede copiar a otra, y
 * cualquier alteracion (o una clave maestra distinta) hace que el descifrado falle en
 * lugar de devolver basura.
 *
 * La clave maestra sale, por este orden, de:
 *   1. `CREDENTIALS_ENCRYPTION_KEY` (obligatoria en un despliegue sin disco escribible);
 *   2. `.data/credentials.key`, que se crea sola la primera vez (32 bytes aleatorios,
 *      permisos 0600; `.data/` esta en `.gitignore`).
 *
 * Que el texto cifrado y la clave vivan en sitios distintos es lo que protege: una copia
 * de `db.json` o un volcado de la base de datos no bastan para leer las claves.
 */

const KEY_FILE = path.join(process.cwd(), '.data', 'credentials.key');
const SCRYPT_SALT = 'ai-landing-studio/credentials/v1';
const FORMAT = 'v1';

export type KeySource = 'env' | 'file';

export type CryptoErrorCode = 'no_key' | 'bad_blob' | 'decrypt_failed';

export class CredentialsCryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'CredentialsCryptoError';
    this.code = code;
  }
}

let cached: { key: Buffer; source: KeySource } | null = null;

async function readKeyFile(): Promise<Buffer | null> {
  try {
    const raw = (await fs.readFile(KEY_FILE, 'utf8')).trim();
    if (!/^[0-9a-f]{64}$/i.test(raw)) {
      throw new CredentialsCryptoError(
        'no_key',
        'El archivo .data/credentials.key no tiene el formato esperado (64 caracteres hexadecimales).',
      );
    }
    return Buffer.from(raw, 'hex');
  } catch (error) {
    if (error instanceof CredentialsCryptoError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new CredentialsCryptoError('no_key', 'No se pudo leer .data/credentials.key.', error);
  }
}

/** Clave maestra y de donde sale. Lanza `CredentialsCryptoError('no_key')` si no hay forma de tenerla. */
export async function getMasterKey(): Promise<{ key: Buffer; source: KeySource }> {
  if (cached) return cached;

  const secret = env.credentials.encryptionKey;
  if (secret) {
    cached = { key: scryptSync(secret, SCRYPT_SALT, 32), source: 'env' };
    return cached;
  }

  const existing = await readKeyFile();
  if (existing) {
    cached = { key: existing, source: 'file' };
    return cached;
  }

  try {
    await fs.mkdir(path.dirname(KEY_FILE), { recursive: true });
    // `wx`: si otra peticion la creo mientras tanto, no se pisa.
    await fs.writeFile(KEY_FILE, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new CredentialsCryptoError(
        'no_key',
        'No se pudo crear la clave de cifrado en .data/ (¿sistema de archivos de solo lectura?). ' +
          'Define CREDENTIALS_ENCRYPTION_KEY en las variables de entorno del servidor.',
        error,
      );
    }
  }

  const created = await readKeyFile();
  if (!created) throw new CredentialsCryptoError('no_key', 'No se pudo leer la clave de cifrado recien creada.');
  cached = { key: created, source: 'file' };
  return cached;
}

/** Para las pruebas: descarta la clave en memoria (no toca el archivo). */
export function resetMasterKeyCache(): void {
  cached = null;
}

/* ---------------------------- primitivas puras ---------------------------- */

export function encryptWithKey(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [FORMAT, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptWithKey(key: Buffer, blob: string, aad: string): string {
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== FORMAT) {
    throw new CredentialsCryptoError('bad_blob', 'Las credenciales guardadas tienen un formato desconocido.');
  }
  const [, iv, tag, data] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch (cause) {
    throw new CredentialsCryptoError(
      'decrypt_failed',
      'No se pudieron descifrar las credenciales guardadas (cambio la clave de cifrado o se alteraron).',
      cause,
    );
  }
}

/* ------------------------------ con la clave real ------------------------------ */

export async function encryptCredentials(plaintext: string, userId: string): Promise<string> {
  const { key } = await getMasterKey();
  return encryptWithKey(key, plaintext, userId);
}

export async function decryptCredentials(blob: string, userId: string): Promise<string> {
  const { key } = await getMasterKey();
  return decryptWithKey(key, blob, userId);
}
