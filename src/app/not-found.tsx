import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="max-w-md text-center">
        <FileQuestion className="mx-auto size-7 text-faint" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Esta pagina no existe</h1>
        <p className="mt-2 text-sm text-muted">
          Puede que el recurso se haya eliminado o que pertenezca a otra cuenta.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex h-9 items-center border border-accent bg-accent px-3.5 text-sm font-medium text-accent-ink"
        >
          Volver al dashboard
        </Link>
      </div>
    </main>
  );
}
