import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

/* =========================================================================
 * Kit de interfaz
 *
 * Componentes sin estado, sin dependencias de datos y sin decoracion
 * gratuita. Todos son utilizables desde Server Components.
 * ====================================================================== */

/* ------------------------------------------------------------------ Panel */

export function Panel({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={cn('border border-line bg-panel', className)}
      {...props}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="text-[0.95rem] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, children, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cn('px-4 py-4 sm:px-5', className)} {...props}>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- Boton */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 border font-medium transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap rounded-xs';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent border-accent text-accent-ink hover:brightness-110',
  secondary: 'bg-panel border-line-strong text-ink hover:bg-panel-2',
  ghost: 'bg-transparent border-transparent text-muted hover:text-ink hover:bg-panel-2',
  danger: 'bg-transparent border-danger text-danger hover:bg-danger-soft',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[0.8125rem]',
  md: 'h-9 px-3.5 text-sm',
};

/** Clases de un boton para otros elementos, como un `Link` de Next.js. */
export function buttonClassName({
  variant = 'secondary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], 'no-underline', className);
}

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export interface LinkButtonProps extends ComponentPropsWithoutRef<'a'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <a
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], 'no-underline', className)}
      {...props}
    >
      {children}
    </a>
  );
}

/* ---------------------------------------------------------------- Campos */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-faint">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  'w-full border border-line-strong bg-panel px-2.5 py-2 text-sm text-ink rounded-xs ' +
  'placeholder:text-faint focus:border-accent';

export function Input({ className, ...props }: ComponentPropsWithoutRef<'input'>) {
  return <input className={cn(CONTROL, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<'textarea'>) {
  return <textarea className={cn(CONTROL, 'min-h-24 resize-y leading-relaxed', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentPropsWithoutRef<'select'>) {
  return (
    <select className={cn(CONTROL, 'h-9 appearance-none pr-8', className)} {...props}>
      {children}
    </select>
  );
}

/* --------------------------------------------------------------- Badges */

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-line-strong text-muted',
  accent: 'border-accent/40 bg-accent-soft text-accent',
  ok: 'border-ok/40 bg-ok-soft text-ok',
  warn: 'border-warn/40 bg-warn-soft text-warn',
  danger: 'border-danger/40 bg-danger-soft text-danger',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase tracking-wider rounded-xs',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Avisos */

type AlertTone = 'info' | 'ok' | 'warn' | 'danger';

const ALERT_TONES: Record<AlertTone, { box: string; Icon: ElementType }> = {
  info: { box: 'border-line-strong bg-panel-2 text-ink', Icon: Info },
  ok: { box: 'border-ok/40 bg-ok-soft text-ink', Icon: CheckCircle2 },
  warn: { box: 'border-warn/40 bg-warn-soft text-ink', Icon: AlertTriangle },
  danger: { box: 'border-danger/40 bg-danger-soft text-ink', Icon: XCircle },
};

export function Alert({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { box, Icon } = ALERT_TONES[tone];
  return (
    // En pantallas estrechas las acciones pasan debajo del texto (alineadas con el): si se
    // quedaran a la derecha con `flex-none`, dos botones dejarian al texto una columna de
    // una palabra por linea.
    <div
      className={cn(
        'flex flex-col gap-2 border px-3 py-2.5 text-sm rounded-xs sm:flex-row sm:items-start sm:gap-2.5',
        box,
        className,
      )}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon className="mt-0.5 size-4 flex-none" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {title ? <p className="font-medium">{title}</p> : null}
          {children ? <div className={cn(title && 'mt-0.5', 'text-muted')}>{children}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex-none pl-[1.625rem] sm:pl-0">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------ Vacio/carga */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: ElementType;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid place-items-center border border-dashed border-line px-6 py-12 text-center', className)}>
      <Icon className="size-6 text-faint" aria-hidden="true" />
      <p className="mt-3 font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Cargando' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}

/* --------------------------------------------------------------- Metricas */

export function Metric({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border border-line bg-panel px-4 py-3', className)}>
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 font-mono text-2xl leading-none text-ink">{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------- Indicador estado */

export function StatusDot({ status }: { status: 'connected' | 'not_configured' | 'error' }) {
  const config = {
    connected: { color: 'bg-ok', label: 'Conectado' },
    not_configured: { color: 'bg-faint', label: 'No configurado' },
    error: { color: 'bg-danger', label: 'Error' },
  }[status];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={cn('size-2 rounded-full', config.color)} aria-hidden="true" />
      {config.label}
    </span>
  );
}

/* ----------------------------------------------------------- Descripcion */

export function DefinitionList({
  items,
  className,
}: {
  items: Array<{ term: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div key={item.term}>
          <dt className="eyebrow">{item.term}</dt>
          <dd className="mt-1 text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
