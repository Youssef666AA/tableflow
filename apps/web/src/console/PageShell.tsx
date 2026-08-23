import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Page({
  children,
  className,
  width = 'wide',
}: {
  children: ReactNode;
  className?: string;
  width?: 'wide' | 'full' | 'narrow';
}) {
  return (
    <div
      className={cn(
        'mx-auto px-4 py-6 lg:px-6 lg:py-7',
        width === 'wide' && 'max-w-[90rem]',
        width === 'narrow' && 'max-w-3xl',
        width === 'full' && 'max-w-none',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeading({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[1.5rem] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        {description && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
