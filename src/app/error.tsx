'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Limite de error global. Muestra un mensaje humano y deja el detalle tecnico
 * solo en la consola, nunca en la interfaz.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app]', error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto size-7 text-warn" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Algo se ha roto por nuestro lado</h1>
        <p className="mt-2 text-sm text-muted">
          La operacion no se ha completado. Puedes reintentarlo; si vuelve a fallar, revisa la configuracion del
          proveedor de IA en Ajustes.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-faint">referencia: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex h-9 items-center border border-accent bg-accent px-3.5 text-sm font-medium text-accent-ink"
        >
          Reintentar
        </button>
      </div>
    </main>
  );
}
