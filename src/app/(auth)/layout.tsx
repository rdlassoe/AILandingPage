import Link from 'next/link';

import { env } from '@/lib/env';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      {/* Columna de contexto: explica que es la herramienta antes de pedir datos */}
      <aside className="hidden border-r border-line bg-panel p-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center border border-ink bg-ink font-mono text-[0.625rem] font-bold text-bg"
          >
            AL
          </span>
          AI Landing Studio
        </Link>

        <div className="max-w-md">
          <p className="eyebrow mb-3">Ingenieria de prompts</p>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            De la idea a una Landing Page auditada, versionada y reutilizable.
          </h2>
          <ol className="mt-8 space-y-3 text-sm text-muted">
            {[
              'Defines el proyecto: publico, objetivo, estilo y restricciones.',
              'El Prompt Engine compone el prompt con tu stack y solo las tecnicas de diseno que elijas.',
              'El modelo genera; el validador comprueba; el critico audita.',
              'Refinas, versionas y guardas en tu biblioteca para reutilizarlo.',
            ].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="font-mono text-xs text-faint">{String(index + 1).padStart(2, '0')}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-faint">
          {env.supabase.enabled
            ? 'Autenticacion y datos gestionados por Supabase con Row Level Security.'
            : 'Modo local: los datos se guardan en ./.data en este equipo. Configura Supabase para autenticacion real.'}
        </p>
      </aside>

      <main className="grid place-items-center px-5 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
