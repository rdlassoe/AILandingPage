'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiPut } from '@/lib/api-client';
import { normalizeEol } from '@/lib/preview/instrument';
import type { LandingPage } from '@/types/domain';
import type { ValidationIssue } from '@/types/services';

/**
 * Estado de edicion del HTML de una Landing Page.
 *
 * Hay tres estados y el usuario los ve siempre:
 *   - editando: `draft` difiere de `saved`. El texto existe solo en el
 *     navegador (y como borrador local, para sobrevivir a una recarga). NO es
 *     definitivo: el critico y el refinamiento no lo ven.
 *   - guardar: `PUT /api/landings/[id]/html` actualiza la pagina y crea una
 *     version nueva. Desde entonces es la version vigente.
 *   - descartar: vuelve al ultimo HTML guardado.
 *
 * No hay autosave a la base de datos: cada guardado es una version y se
 * llenaria de copias casi identicas.
 *
 * Todo el texto se normaliza a `\n`: CodeMirror lo expone asi y las posiciones
 * del inspector se calculan sobre ese mismo texto.
 */

type Source = Pick<LandingPage, 'id' | 'html' | 'currentVersion'>;

interface SaveResponse {
  landing: LandingPage;
  issues: ValidationIssue[];
  changed: boolean;
}

interface StoredDraft {
  baseVersion: number;
  html: string;
}

const draftKey = (landingId: string) => `als:draft:${landingId}`;

function readDraft(landingId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(landingId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    return typeof parsed.baseVersion === 'number' && typeof parsed.html === 'string'
      ? { baseVersion: parsed.baseVersion, html: parsed.html }
      : null;
  } catch {
    return null;
  }
}

function writeDraft(landingId: string, draft: StoredDraft) {
  try {
    window.localStorage.setItem(draftKey(landingId), JSON.stringify(draft));
  } catch {
    // Sin almacenamiento (modo privado, cuota): el borrador local es solo una comodidad.
  }
}

function removeDraft(landingId: string) {
  try {
    window.localStorage.removeItem(draftKey(landingId));
  } catch {
    // Igual que arriba.
  }
}

export interface LandingEditorState {
  /** Texto en edicion. */
  draft: string;
  setDraft: (value: string) => void;
  /** Ultimo texto guardado. */
  saved: string;
  savedVersion: number;
  dirty: boolean;
  saving: boolean;
  /** Error del ultimo intento de guardar, listo para mostrar. */
  error: string | null;
  /** La pagina cambio por otro lado mientras se editaba: hay que elegir que texto se queda. */
  conflict: boolean;
  /** Avisos no bloqueantes del validador tras el ultimo guardado. */
  issues: ValidationIssue[];
  /** Resultado del ultimo guardado (para el mensaje "Version vN guardada"). */
  lastSave: { version: number; changed: boolean } | null;
  /** Se recupero un borrador sin guardar de una sesion anterior. */
  restored: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
  /** Conflicto: descarta mi texto y carga la version vigente. */
  loadLatest: () => Promise<void>;
  /** Conflicto: conserva mi texto para guardarlo como la version siguiente a la vigente. */
  keepMine: () => Promise<void>;
}

export function useLandingEditor(
  landing: Source | null,
  options: { onSaved?: (landing: LandingPage) => void } = {},
): LandingEditorState {
  const id = landing?.id ?? null;
  const html = landing?.html ?? '';
  const version = landing?.currentVersion ?? 0;

  const initial = normalizeEol(html);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [savedVersion, setSavedVersion] = useState(version);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [staleBase, setStaleBase] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [lastSave, setLastSave] = useState<LandingEditorState['lastSave']>(null);
  const [restored, setRestored] = useState(false);

  const dirty = draft !== saved;

  // Valores actuales para los efectos, sin volver a ejecutarlos por ellos.
  const loadedId = useRef(id);
  const savedVersionRef = useRef(savedVersion);
  const dirtyRef = useRef(dirty);
  const onSavedRef = useRef(options.onSaved);
  useEffect(() => {
    savedVersionRef.current = savedVersion;
    dirtyRef.current = dirty;
    onSavedRef.current = options.onSaved;
  });

  const adopt = useCallback((nextHtml: string, nextVersion: number) => {
    setSaved(nextHtml);
    setDraft(nextHtml);
    setSavedVersion(nextVersion);
    setIssues([]);
    setError(null);
    setSaveConflict(false);
    setStaleBase(false);
    setRestored(false);
    setLastSave(null);
  }, []);

  // La pagina que llega de fuera cambio (otra pagina, una version nueva por un refinamiento...).
  useEffect(() => {
    if (id === null) {
      if (loadedId.current !== null) {
        loadedId.current = null;
        adopt('', 0);
      }
      return;
    }

    const samePage = id === loadedId.current;
    // Lo que ya tenemos cargado (por ejemplo, justo despues de guardar): nada que hacer.
    if (samePage && version === savedVersionRef.current) return;
    // Alguien cambio la pagina mientras habia texto sin guardar: no se pisa, se avisa.
    if (samePage && dirtyRef.current) {
      setStaleBase(true);
      return;
    }

    loadedId.current = id;
    adopt(normalizeEol(html), version);
  }, [id, html, version, adopt]);

  // Borrador de una sesion anterior (se lee tras montar: en el servidor no hay localStorage).
  useEffect(() => {
    if (id === null) return;
    const stored = readDraft(id);
    if (!stored) return;
    if (stored.baseVersion !== version || stored.html === normalizeEol(html)) {
      removeDraft(id);
      return;
    }
    setDraft(stored.html);
    setRestored(true);
  }, [id, html, version]);

  // Conserva el borrador local mientras haya cambios sin guardar.
  useEffect(() => {
    if (id === null) return;
    if (draft === saved) {
      removeDraft(id);
      return;
    }
    const timer = setTimeout(() => writeDraft(id, { baseVersion: savedVersion, html: draft }), 400);
    return () => clearTimeout(timer);
  }, [id, draft, saved, savedVersion]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    if (id === null || !dirty || saving) return false;

    setSaving(true);
    setError(null);
    setSaveConflict(false);

    const sent = draft;
    const result = await apiPut<SaveResponse>(`/api/landings/${id}/html`, {
      html: sent,
      expectedVersion: savedVersion,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error.message + (result.error.hint ? ` ${result.error.hint}` : ''));
      setSaveConflict(result.error.code === 'conflict');
      return false;
    }

    const { landing: next, issues: nextIssues, changed } = result.data;
    // Si se siguio escribiendo durante la peticion, `draft` seguira difiriendo: sigue "sin guardar".
    setSaved(sent);
    setSavedVersion(next.currentVersion);
    setIssues(nextIssues);
    setLastSave({ version: next.currentVersion, changed });
    setRestored(false);
    setStaleBase(false);
    removeDraft(id);
    onSavedRef.current?.(next);
    return true;
  }, [id, dirty, saving, draft, savedVersion]);

  const discard = useCallback(() => {
    if (id !== null) removeDraft(id);
    setDraft(saved);
    setError(null);
    setSaveConflict(false);
    setRestored(false);
  }, [id, saved]);

  const fetchLatest = useCallback(async (): Promise<LandingPage | null> => {
    if (id === null) return null;
    const result = await apiGet<LandingPage>(`/api/landings/${id}`);
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    return result.data;
  }, [id]);

  const loadLatest = useCallback(async () => {
    const latest = await fetchLatest();
    if (!latest) return;
    if (id !== null) removeDraft(id);
    adopt(normalizeEol(latest.html), latest.currentVersion);
    onSavedRef.current?.(latest);
  }, [fetchLatest, id, adopt]);

  const keepMine = useCallback(async () => {
    const latest = await fetchLatest();
    if (!latest) return;
    // Mi texto pasa a ser un cambio sobre la version vigente: al guardar queda como la siguiente.
    setSaved(normalizeEol(latest.html));
    setSavedVersion(latest.currentVersion);
    setError(null);
    setSaveConflict(false);
    setStaleBase(false);
    onSavedRef.current?.(latest);
  }, [fetchLatest]);

  return {
    draft,
    setDraft,
    saved,
    savedVersion,
    dirty,
    saving,
    error,
    conflict: saveConflict || staleBase,
    issues,
    lastSave,
    restored,
    save,
    discard,
    loadLatest,
    keepMine,
  };
}
