'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';

import { Alert, Badge, Button, Input } from '@/components/ui';
import { apiPut } from '@/lib/api-client';
import type { CredentialField, CredentialsStatus, FieldStatus } from '@/lib/credentials';

/**
 * Formulario de credenciales de un proveedor (una o varias casillas).
 *
 * Nunca recibe ni muestra un valor guardado: solo de donde sale (Ajustes, entorno del servidor
 * o ninguna) y los cuatro ultimos caracteres. Lo escrito se envia por HTTPS al servidor, que lo
 * cifra, y se borra de la pantalla en cuanto se guarda. Las casillas son de tipo password y
 * sin autocompletado para que el navegador no ofrezca guardarlas ni las rellene.
 */

export interface CredentialFieldDef {
  field: CredentialField;
  label: string;
  /** `secret`: se oculta al escribir. `text`: valor no secreto (URL, Account ID). */
  kind: 'secret' | 'text';
  placeholder: string;
  help?: string;
}

const SOURCE_BADGE: Record<FieldStatus['source'], { tone: 'ok' | 'neutral' | 'warn'; label: string }> = {
  settings: { tone: 'ok', label: 'guardada en Ajustes' },
  env: { tone: 'neutral', label: 'del servidor (.env)' },
  none: { tone: 'warn', label: 'sin configurar' },
};

export function CredentialForm({
  fields,
  credentials,
  saveLabel = 'Guardar',
}: {
  fields: CredentialFieldDef[];
  credentials: CredentialsStatus;
  saveLabel?: string;
}) {
  const router = useRouter();
  const baseId = useId();
  const [values, setValues] = useState<Partial<Record<CredentialField, string>>>({});
  const [busy, setBusy] = useState<'save' | CredentialField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { storage } = credentials;

  /** Por que una casilla no se puede editar, o `null` si se puede. */
  const lockedReason = (def: CredentialFieldDef): string | null => {
    if (def.field === 'ollamaBaseUrl' && !storage.ollamaUrlEditable) {
      return 'En un despliegue compartido la URL de Ollama se define con OLLAMA_BASE_URL en el servidor.';
    }
    if (!storage.available) return 'No se pueden guardar claves ahora mismo (ver el aviso de arriba).';
    return null;
  };

  const changed = fields.filter((def) => (values[def.field] ?? '').trim().length > 0);

  const send = async (patch: Partial<Record<CredentialField, string | null>>, kind: 'save' | CredentialField) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    const result = await apiPut<CredentialsStatus>('/api/settings/credentials', patch);
    setBusy(null);
    if (!result.ok) {
      setError([result.error.message, result.error.hint].filter(Boolean).join(' '));
      return;
    }
    // Lo escrito deja de estar en pantalla; el servidor ya lo tiene cifrado.
    setValues((current) => {
      const next = { ...current };
      for (const field of Object.keys(patch) as CredentialField[]) delete next[field];
      return next;
    });
    setNotice(kind === 'save' ? 'Guardado. Pulsa «Probar conexion» para comprobarlo.' : 'Quitada de Ajustes.');
    router.refresh();
  };

  const save = () => {
    const patch: Partial<Record<CredentialField, string | null>> = {};
    for (const def of changed) patch[def.field] = (values[def.field] ?? '').trim();
    void send(patch, 'save');
  };

  return (
    <div className="grid gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="ok">{notice}</Alert> : null}

      {fields.map((def) => {
        const status = credentials.fields[def.field];
        const locked = lockedReason(def);
        const id = `${baseId}-${def.field}`;
        const badge = SOURCE_BADGE[status.source];

        return (
          <div key={def.field} className="grid gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={id} className="text-[0.8125rem] font-medium text-ink">
                {def.label}
              </label>
              <span className="flex items-center gap-1.5">
                {status.hint ? <span className="font-mono text-xs text-muted">{status.hint}</span> : null}
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </span>
            </div>

            <div className="flex gap-2">
              <Input
                id={id}
                type={def.kind === 'secret' ? 'password' : 'text'}
                value={values[def.field] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [def.field]: event.target.value }))}
                placeholder={status.source === 'settings' ? 'Escribe una nueva para sustituirla' : def.placeholder}
                disabled={locked !== null}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                // Evita que los gestores de contrasenas la traten como un inicio de sesion.
                data-1p-ignore
                data-lpignore="true"
                className="min-w-0 flex-1 font-mono text-xs"
              />
              {status.source === 'settings' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9"
                  onClick={() => void send({ [def.field]: null }, def.field)}
                  loading={busy === def.field}
                  disabled={busy !== null && busy !== def.field}
                  aria-label={`Quitar ${def.label} de Ajustes`}
                  title="Quitar de Ajustes (se vuelve a usar la del servidor, si hay)"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            {locked ? <p className="text-xs text-muted">{locked}</p> : def.help ? <p className="text-xs text-faint">{def.help}</p> : null}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={save} loading={busy === 'save'} disabled={changed.length === 0 || (busy !== null && busy !== 'save')}>
          <KeyRound className="size-3.5" aria-hidden="true" />
          {saveLabel}
        </Button>
        {changed.length === 0 ? <span className="text-xs text-faint">Escribe un valor para poder guardarlo.</span> : null}
      </div>
    </div>
  );
}
