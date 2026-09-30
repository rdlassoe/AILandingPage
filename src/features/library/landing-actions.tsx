'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Code2, Copy, Download, RotateCcw, Save, Trash2 } from 'lucide-react';

import { Alert, Button, Field, Input, Select, buttonClassName } from '@/components/ui';
import { apiDelete, apiPatch, apiPost } from '@/lib/api-client';
import type { LandingPage, LandingStatus } from '@/types/domain';

const STATUS_LABELS: Array<{ value: LandingStatus; label: string; hint: string }> = [
  { value: 'draft', label: 'Borrador', hint: 'Trabajo en curso, solo visible para ti.' },
  { value: 'private', label: 'Privada', hint: 'Terminada, pero no aparece en la biblioteca publica.' },
  { value: 'public', label: 'Publica', hint: 'Visible en la biblioteca publica de la instancia.' },
  { value: 'featured', label: 'Destacada', hint: 'Publica y resaltada en la portada de la biblioteca.' },
];

/** Acciones sobre una Landing Page guardada. */
export function LandingActions({ landing }: { landing: LandingPage }) {
  const router = useRouter();
  const [name, setName] = useState(landing.name);
  const [status, setStatus] = useState<LandingStatus>(landing.status);
  const [busy, setBusy] = useState<null | 'saving' | 'reusing' | 'deleting'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dirty = name !== landing.name || status !== landing.status;

  const save = async () => {
    setBusy('saving');
    setError(null);
    setNotice(null);

    const result = await apiPatch<LandingPage>(`/api/landings/${landing.id}`, { name, status });
    if (!result.ok) {
      setError(result.error.message);
      setBusy(null);
      return;
    }

    setNotice('Cambios guardados.');
    setBusy(null);
    router.refresh();
  };

  const reuse = async () => {
    setBusy('reusing');
    setError(null);

    const result = await apiPost<{ projectId: string }>(`/api/landings/${landing.id}/reuse`, {});
    if (!result.ok) {
      setError(result.error.message);
      setBusy(null);
      return;
    }

    router.push(`/projects/${result.data.projectId}`);
    router.refresh();
  };

  const remove = async () => {
    setBusy('deleting');
    setError(null);

    const result = await apiDelete(`/api/landings/${landing.id}`);
    if (!result.ok) {
      setError(result.error.message);
      setBusy(null);
      return;
    }

    router.push('/library');
    router.refresh();
  };

  const download = () => {
    const blob = new Blob([landing.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug(landing.name)}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(landing.html);
      setNotice('HTML copiado al portapapeles.');
    } catch {
      setError('Tu navegador no permitio copiar al portapapeles.');
    }
  };

  return (
    <div className="grid gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="ok">{notice}</Alert> : null}

      <Field label="Nombre" htmlFor="landing-name">
        <Input id="landing-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={140} />
      </Field>

      <Field
        label="Visibilidad"
        htmlFor="landing-status"
        hint={STATUS_LABELS.find((item) => item.value === status)?.hint}
      >
        <Select
          id="landing-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as LandingStatus)}
        >
          {STATUS_LABELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>

      <Button variant="primary" onClick={save} loading={busy === 'saving'} disabled={!dirty}>
        <Save className="size-4" aria-hidden="true" />
        Guardar cambios
      </Button>

      <div className="grid gap-2 border-t border-line pt-3">
        <Link href={`/library/${landing.id}/edit`} className={buttonClassName()}>
          <Code2 className="size-4" aria-hidden="true" />
          Editar codigo
        </Link>
        <p className="text-xs text-faint">
          Edita el HTML a mano, inspecciona la pagina y salta a la linea de cada elemento. Cada guardado crea una
          version nueva en el historial.
        </p>
      </div>

      <div className="grid gap-2 border-t border-line pt-3">
        <Button onClick={reuse} loading={busy === 'reusing'}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Reutilizar en un proyecto nuevo
        </Button>
        <p className="text-xs text-faint">
          Copia el brief, el stack y las restricciones a un proyecto nuevo para modificarlos antes de
          volver a generar. La Seed String se genera de nuevo en la siguiente ejecucion.
        </p>
      </div>

      <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
        <Button onClick={download}>
          <Download className="size-4" aria-hidden="true" />
          Descargar HTML
        </Button>
        <Button onClick={copyHtml}>
          <Copy className="size-4" aria-hidden="true" />
          Copiar HTML
        </Button>
      </div>

      <div className="border-t border-line pt-3">
        {confirmingDelete ? (
          <div className="grid gap-2">
            <Alert tone="warn" title="Eliminar esta Landing Page">
              Se borran tambien sus versiones y sus auditorias. No se puede deshacer.
            </Alert>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" onClick={remove} loading={busy === 'deleting'}>
                Si, eliminar
              </Button>
              <Button size="sm" onClick={() => setConfirmingDelete(false)} disabled={busy === 'deleting'}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Eliminar
          </Button>
        )}
      </div>
    </div>
  );
}

function slug(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'landing-page'
  );
}
