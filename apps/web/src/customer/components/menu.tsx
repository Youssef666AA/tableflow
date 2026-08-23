import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Minus, Plus, Sparkles, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { Badge, Button, Textarea } from '@/components/ui/primitives';
import { BottomSheet } from '@/components/ui/overlays';
import { FoodImage } from '@/components/ui/food-image';
import type { MenuCategory, MenuProduct } from '../types';
import type { CartLine } from '../cart';

/* ------------------------------------------------------ CategoryScroller */

export function CategoryScroller({
  categories,
  activeId,
  onSelect,
}: {
  categories: MenuCategory[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the selected chip in view when the page scroll-spies a new section.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeId]);

  return (
    <div className="sticky top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-20 -mx-4 bg-canvas/85 px-4 py-2 backdrop-blur-lg">
      <div ref={containerRef} className="no-scrollbar flex gap-2 overflow-x-auto">
        <CategoryChip label="All" active={activeId === null} onClick={() => onSelect(null)} />
        {categories.map((category) => (
          <CategoryChip
            key={category.id}
            label={category.name}
            count={category.productCount}
            active={activeId === category.id}
            onClick={() => onSelect(category.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-active={active}
      onClick={onClick}
      className={cn(
        'relative shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200',
        active ? 'text-ink-inverse' : 'bg-surface text-ink-soft ring-1 ring-inset ring-line hover:bg-surface-sunken',
      )}
    >
      {active && (
        <motion.span
          layoutId="category-pill"
          className="absolute inset-0 rounded-full bg-ink"
          transition={{ type: 'spring', damping: 30, stiffness: 380 }}
        />
      )}
      <span className="relative">
        {label}
        {count !== undefined && count > 0 && (
          <span className={cn('ml-1.5 text-2xs tabular', active ? 'opacity-60' : 'text-ink-muted')}>{count}</span>
        )}
      </span>
    </button>
  );
}

/* ----------------------------------------------------------- ProductCard */

export function ProductCard({
  product,
  currency,
  onOpen,
}: {
  product: MenuProduct;
  currency: string;
  onOpen: (product: MenuProduct) => void;
}) {
  const unavailable = product.status !== 'AVAILABLE';
  const fromPrice =
    product.variants.length > 0
      ? product.basePrice + Math.min(...product.variants.map((v) => v.priceDelta))
      : product.basePrice;

  return (
    <button
      onClick={() => !unavailable && onOpen(product)}
      disabled={unavailable}
      className={cn(
        'group flex w-full items-stretch gap-3.5 rounded-lg border border-line bg-surface p-3 text-left shadow-subtle transition-all duration-200',
        unavailable ? 'cursor-not-allowed opacity-60' : 'active:scale-[0.99] hover:shadow-lift',
      )}
    >
      <div className="relative size-[5.5rem] shrink-0 overflow-hidden rounded-md">
        <FoodImage name={product.name} src={product.imageUrl} />
        {unavailable && (
          <span className="absolute inset-0 flex items-center justify-center bg-ink/55 px-1 text-center text-2xs font-semibold leading-tight text-white">
            Currently unavailable
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[0.9375rem] font-semibold leading-snug text-ink">{product.name}</h3>
          {product.popular && !unavailable && (
            <Flame className="mt-0.5 size-4 shrink-0 text-gold" aria-label="Popular" />
          )}
        </div>

        {product.description && (
          <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-muted">
            {product.description}
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="tabular text-[0.9375rem] font-semibold text-ink">
              {product.variants.length > 0 && <span className="mr-1 text-xs font-normal text-ink-muted">from</span>}
              {money(fromPrice, currency)}
            </p>
            {product.ratingCount > 0 && (
              <p className="mt-0.5 flex items-center gap-1 text-2xs text-ink-muted">
                <Star className="size-3 fill-gold text-gold" aria-hidden />
                <span className="tabular">{product.rating.toFixed(1)}</span>
                <span>({product.ratingCount})</span>
              </p>
            )}
          </div>

          {!unavailable && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong transition-colors group-hover:bg-accent group-hover:text-white">
              <Plus className="size-4" strokeWidth={2.4} aria-hidden />
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------- FeaturedCarousel */

export function FeaturedRail({
  products,
  currency,
  onOpen,
}: {
  products: MenuProduct[];
  currency: string;
  onOpen: (product: MenuProduct) => void;
}) {
  if (products.length === 0) return null;

  return (
    <section className="pt-1">
      <div className="mb-2.5 flex items-center gap-2 px-4">
        <Sparkles className="size-4 text-gold" aria-hidden />
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-ink-soft">Chef's picks</h2>
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        {products.map((product) => (
          <button
            key={product.id}
            onClick={() => onOpen(product)}
            className="w-[13.5rem] shrink-0 snap-start overflow-hidden rounded-lg border border-line bg-surface text-left shadow-subtle transition-transform active:scale-[0.98]"
          >
            <div className="h-28 w-full">
              <FoodImage name={product.name} src={product.imageUrl} rounded="rounded-none" />
            </div>
            <div className="p-3">
              <h3 className="truncate text-sm font-semibold text-ink">{product.name}</h3>
              <p className="tabular mt-1 text-sm font-semibold text-accent-strong">
                {money(product.basePrice, currency)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- ProductSheet */

interface Selection {
  variantId: string | null;
  optionIds: Set<string>;
  quantity: number;
  notes: string;
}

export function ProductSheet({
  product,
  currency,
  open,
  onClose,
  onAdd,
}: {
  product: MenuProduct | null;
  currency: string;
  open: boolean;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
}) {
  const [selection, setSelection] = useState<Selection>({
    variantId: null,
    optionIds: new Set(),
    quantity: 1,
    notes: '',
  });
  const [attemptedAdd, setAttemptedAdd] = useState(false);

  // Reset to sensible defaults each time a different dish is opened.
  useEffect(() => {
    if (!product) return;
    const firstAvailableVariant = product.variants.find((v) => v.available);
    const defaults = new Set<string>();
    for (const group of product.modifierGroups) {
      if (group.required || group.minSelect > 0) {
        const first = group.options.find((option) => option.available);
        if (first) defaults.add(first.id);
      }
    }
    setSelection({
      variantId: firstAvailableVariant?.id ?? null,
      optionIds: defaults,
      quantity: 1,
      notes: '',
    });
    setAttemptedAdd(false);
  }, [product]);

  const unitPrice = useMemo(() => {
    if (!product) return 0;
    const variant = product.variants.find((v) => v.id === selection.variantId);
    const modifiers = product.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => selection.optionIds.has(option.id))
      .reduce((sum, option) => sum + option.priceDelta, 0);
    return product.basePrice + (variant?.priceDelta ?? 0) + modifiers;
  }, [product, selection]);

  const groupErrors = useMemo(() => {
    if (!product) return new Map<string, string>();
    const errors = new Map<string, string>();
    for (const group of product.modifierGroups) {
      const chosen = group.options.filter((option) => selection.optionIds.has(option.id)).length;
      const min = group.required ? Math.max(1, group.minSelect) : group.minSelect;
      const max = group.selectionType === 'SINGLE' ? 1 : (group.maxSelect ?? group.options.length);
      if (chosen < min) errors.set(group.id, `Choose at least ${min}`);
      else if (chosen > max) errors.set(group.id, `Choose at most ${max}`);
    }
    return errors;
  }, [product, selection]);

  if (!product) return null;

  const toggleOption = (group: MenuProduct['modifierGroups'][number], optionId: string) => {
    setSelection((current) => {
      const next = new Set(current.optionIds);
      if (group.selectionType === 'SINGLE') {
        group.options.forEach((option) => next.delete(option.id));
        next.add(optionId);
      } else if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        const max = group.maxSelect ?? group.options.length;
        const chosen = group.options.filter((option) => next.has(option.id)).length;
        if (chosen < max) next.add(optionId);
      }
      return { ...current, optionIds: next };
    });
  };

  const handleAdd = () => {
    setAttemptedAdd(true);
    if (groupErrors.size > 0) return;

    const variant = product.variants.find((v) => v.id === selection.variantId) ?? null;
    const chosen = product.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => selection.optionIds.has(option.id));

    onAdd({
      productId: product.id,
      productName: product.name,
      imageUrl: product.imageUrl,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      quantity: selection.quantity,
      modifierOptionIds: chosen.map((option) => option.id),
      modifierLabels: chosen.map((option) => option.name),
      notes: selection.notes.trim() || null,
      estimatedUnitPrice: unitPrice,
    });
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex items-center gap-3">
          <QuantityStepper
            value={selection.quantity}
            onChange={(quantity) => setSelection((current) => ({ ...current, quantity }))}
          />
          <Button size="lg" fullWidth onClick={handleAdd} className="flex-1">
            <span>Add to cart</span>
            <span className="tabular ml-auto font-semibold">
              {money(unitPrice * selection.quantity, currency)}
            </span>
          </Button>
        </div>
      }
    >
      <div className="h-52 w-full sm:h-56">
        <FoodImage name={product.name} src={product.imageUrl} rounded="rounded-none" eager />
      </div>

      <div className="px-5 pb-6 pt-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-[1.375rem] font-semibold leading-tight text-ink">{product.name}</h2>
          <p className="tabular shrink-0 text-lg font-semibold text-ink">{money(product.basePrice, currency)}</p>
        </div>

        {product.description && (
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{product.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {product.popular && <Badge tone="gold" size="sm">Popular</Badge>}
          {product.tags.map((tag) => (
            <Badge key={tag} size="sm">{tag}</Badge>
          ))}
          <Badge size="sm" tone="neutral">~{product.prepTimeMinutes} min</Badge>
          {product.calories != null && <Badge size="sm">{product.calories} kcal</Badge>}
        </div>

        {product.allergens.length > 0 && (
          <p className="mt-3 text-xs text-ink-muted">
            <span className="font-medium text-ink-soft">Allergens:</span> {product.allergens.join(', ')}
          </p>
        )}

        {product.variants.length > 0 && (
          <OptionGroup
            title="Choose an option"
            required
            error={null}
          >
            {product.variants.map((variant) => (
              <OptionRow
                key={variant.id}
                type="radio"
                name="variant"
                label={variant.name}
                priceDelta={variant.priceDelta}
                currency={currency}
                checked={selection.variantId === variant.id}
                disabled={!variant.available}
                onChange={() => setSelection((current) => ({ ...current, variantId: variant.id }))}
              />
            ))}
          </OptionGroup>
        )}

        {product.modifierGroups.map((group) => {
          const error = attemptedAdd ? (groupErrors.get(group.id) ?? null) : null;
          const max = group.selectionType === 'SINGLE' ? 1 : (group.maxSelect ?? group.options.length);
          return (
            <OptionGroup
              key={group.id}
              title={group.name}
              required={group.required || group.minSelect > 0}
              hint={group.selectionType === 'MULTIPLE' ? `Up to ${max}` : undefined}
              error={error}
            >
              {group.options.map((option) => (
                <OptionRow
                  key={option.id}
                  type={group.selectionType === 'SINGLE' ? 'radio' : 'checkbox'}
                  name={group.id}
                  label={option.name}
                  priceDelta={option.priceDelta}
                  currency={currency}
                  checked={selection.optionIds.has(option.id)}
                  disabled={!option.available}
                  onChange={() => toggleOption(group, option.id)}
                />
              ))}
            </OptionGroup>
          );
        })}

        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-ink">Anything else?</h3>
          <Textarea
            value={selection.notes}
            onChange={(event) => setSelection((current) => ({ ...current, notes: event.target.value }))}
            placeholder="No ice, please cut in half…"
            maxLength={280}
            rows={2}
          />
        </div>
      </div>
    </BottomSheet>
  );
}

function OptionGroup({
  title,
  required,
  hint,
  error,
  children,
}: {
  title: string;
  required?: boolean;
  hint?: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">
          {title}
          {required && <span className="ml-1.5 text-2xs font-medium uppercase tracking-wide text-accent">Required</span>}
        </h3>
        {hint && <span className="text-2xs text-ink-muted">{hint}</span>}
      </div>
      <div className="overflow-hidden rounded-md border border-line">{children}</div>
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </section>
  );
}

function OptionRow({
  type,
  name,
  label,
  priceDelta,
  currency,
  checked,
  disabled,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  label: string;
  priceDelta: number;
  currency: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 border-b border-line px-3.5 py-3 last:border-0 transition-colors',
        disabled ? 'cursor-not-allowed opacity-45' : 'active:bg-surface-sunken',
        checked && !disabled && 'bg-accent-soft/50',
      )}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className={cn(
          'size-[1.125rem] shrink-0 border-line-strong text-accent focus:ring-accent/40',
          type === 'radio' ? 'rounded-full' : 'rounded',
        )}
      />
      <span className="min-w-0 flex-1 text-sm text-ink">{label}</span>
      {priceDelta !== 0 && (
        <span className="tabular shrink-0 text-sm font-medium text-ink-soft">
          {priceDelta > 0 ? '+' : '−'}
          {money(Math.abs(priceDelta), currency)}
        </span>
      )}
      {disabled && <span className="shrink-0 text-2xs text-ink-muted">Unavailable</span>}
    </label>
  );
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 50,
  size = 'lg',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'lg';
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center rounded-md border border-line-strong bg-surface',
        size === 'lg' ? 'h-12' : 'h-9',
      )}
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(min - 1, value - 1))}
        disabled={value <= min - 1}
        className={cn(
          'flex h-full items-center justify-center text-ink-soft transition-colors hover:text-ink disabled:opacity-35',
          size === 'lg' ? 'w-11' : 'w-8',
        )}
      >
        <Minus className={size === 'lg' ? 'size-4' : 'size-3.5'} strokeWidth={2.4} />
      </button>
      <span
        className={cn(
          'tabular min-w-6 text-center font-semibold text-ink',
          size === 'lg' ? 'text-base' : 'text-sm',
        )}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className={cn(
          'flex h-full items-center justify-center text-ink-soft transition-colors hover:text-ink disabled:opacity-35',
          size === 'lg' ? 'w-11' : 'w-8',
        )}
      >
        <Plus className={size === 'lg' ? 'size-4' : 'size-3.5'} strokeWidth={2.4} />
      </button>
    </div>
  );
}
