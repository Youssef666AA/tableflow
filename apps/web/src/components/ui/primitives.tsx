import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ---------------------------------------------------------------- Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'gold';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-strong active:bg-accent-strong disabled:bg-accent/50 shadow-subtle',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-surface-sunken active:bg-surface-sunken',
  ghost: 'text-ink-soft hover:bg-surface-sunken hover:text-ink active:bg-surface-sunken',
  subtle: 'bg-surface-sunken text-ink hover:bg-line active:bg-line',
  danger: 'bg-danger text-white hover:brightness-95 active:brightness-90 shadow-subtle',
  gold: 'bg-gold text-white hover:brightness-95 active:brightness-90 shadow-subtle',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5 rounded-sm',
  md: 'h-10 px-4 text-sm gap-2 rounded',
  lg: 'h-12 px-5 text-[0.9375rem] gap-2 rounded-md',
  xl: 'h-14 px-6 text-base gap-2.5 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, fullWidth, leadingIcon, trailingIcon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-all duration-150 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'active:scale-[0.985]',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        leadingIcon
      )}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  label: string;
}

const ICON_SIZES = { sm: 'size-8 rounded-sm', md: 'size-10 rounded', lg: 'size-12 rounded-md' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', label, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-all duration-150 ease-out active:scale-95',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        ICON_SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/* ----------------------------------------------------------------- Badge */

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'gold';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-soft ring-1 ring-inset ring-line',
  accent: 'bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent/20',
  success: 'bg-success-soft text-success ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-soft text-warning ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-1 ring-inset ring-danger/20',
  info: 'bg-info-soft text-info ring-1 ring-inset ring-info/20',
  gold: 'bg-gold-soft text-gold ring-1 ring-inset ring-gold/25',
};

export function Badge({
  tone = 'neutral',
  size = 'md',
  dot,
  className,
  children,
}: {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  className,
  children,
  as: Tag = 'div',
  interactive,
  ...props
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
  interactive?: boolean;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn(
        'rounded-lg border border-line bg-surface shadow-subtle',
        interactive && 'cursor-pointer transition-shadow duration-200 hover:shadow-lift',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pb-4 pt-5', className)}>
      <div className="min-w-0">
        <h3 className="truncate text-[0.9375rem] font-semibold leading-tight text-ink">{title}</h3>
        {description && <p className="mt-1 text-sm leading-snug text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Field */

export function Label({
  htmlFor,
  children,
  required,
  hint,
  className,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-1.5 flex items-baseline justify-between gap-3', className)}>
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-ink-soft">
        {children}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {hint && <span className="text-2xs text-ink-muted">{hint}</span>}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  description,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  htmlFor?: string;
  error?: string | null;
  hint?: ReactNode;
  description?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required} hint={hint}>
          {label}
        </Label>
      )}
      {children}
      {description && !error && <p className="mt-1.5 text-xs text-ink-muted">{description}</p>}
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

const CONTROL =
  'w-full rounded border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70 ' +
  'transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(CONTROL, 'h-10', invalid && 'border-danger focus:border-danger focus:ring-danger/25', className)}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, rows = 3, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(CONTROL, 'resize-y py-2.5 leading-relaxed', invalid && 'border-danger focus:ring-danger/25', className)}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(CONTROL, 'h-10 cursor-pointer appearance-none pr-9', className)}
          {...props}
        >
          {children}
        </select>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  },
);

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow-subtle transition-transform duration-200 ease-out',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-ink">{label}</span>}
          {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{description}</span>}
        </span>
      )}
    </label>
  );
}

/* --------------------------------------------------------------- Loading */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-ink-muted', className)} aria-hidden />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />;
}

export function Divider({ className, label }: { className?: string; label?: string }) {
  if (label) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <span className="h-px flex-1 bg-line" />
        <span className="text-2xs font-medium uppercase tracking-wider text-ink-muted">{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return <hr className={cn('border-0 border-t border-line', className)} />;
}

/* ------------------------------------------------------ Segmented control */

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; count?: number }>;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-surface-sunken p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative inline-flex items-center gap-2 rounded font-medium transition-all duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
              active
                ? 'bg-surface text-ink shadow-subtle'
                : 'text-ink-muted hover:text-ink-soft',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-2xs tabular',
                  active ? 'bg-accent-soft text-accent-strong' : 'bg-line text-ink-muted',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
