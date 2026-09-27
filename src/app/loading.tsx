export default function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-live="polite">
      <span className="inline-flex items-center gap-2 text-sm text-muted">
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        />
        Cargando...
      </span>
    </div>
  );
}
