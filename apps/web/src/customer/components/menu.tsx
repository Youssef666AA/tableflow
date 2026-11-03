import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Clock, Flame, Leaf, Minus, Plus, Sparkles, Star, X } from 'lucide-react';
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
    <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-20 -mx-4 border-b border-line/60 bg-[#FAF8F5]/90 px-4 py-2.5 backdrop-blur-xl">
      <div ref={containerRef} className="no-scrollbar flex items-center gap-2 overflow-x-auto scroll-smooth">
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
      type="button"
      data-active={active}
      onClick={onClick}
      className={cn(
        'relative shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold transition-all duration-200 active:scale-95',
        active
          ? 'text-white shadow-lift'
          : 'bg-white text-ink-soft ring-1 ring-inset ring-line/80 hover:bg-stone-50 hover:text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId="category-pill"
          className="absolute inset-0 rounded-full bg-[#141413]"
          transition={{ type: 'spring', damping: 28, stiffness: 380 }}
        />
      )}
      <span className="relative flex items-center gap-1.5">
        {label}
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              'rounded-full px-1.5 py-0.2 text-[10px] font-semibold tabular',
              active ? 'bg-white/20 text-white' : 'bg-stone-100 text-ink-muted',
            )}
          >
            {count}
          </span>
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
  cartCount = 0,
}: {
  product: MenuProduct;
  currency: string;
  onOpen: (product: MenuProduct) => void;
  cartCount?: number;
}) {
  const unavailable = product.status !== 'AVAILABLE';
  const fromPrice =
    product.variants.length > 0
      ? product.basePrice + Math.min(...product.variants.map((v) => v.priceDelta))
      : product.basePrice;

  const isVeg = product.tags.some((t) => /veg/i.test(t));
  const isSpicy = product.tags.some((t) => /spic/i.test(t));

  return (
    <button
      type="button"
      onClick={() => !unavailable && onOpen(product)}
      disabled={unavailable}
      className={cn(
        'group flex w-full items-stretch justify-between gap-3.5 rounded-2xl border border-line/75 bg-surface p-3.5 text-left shadow-subtle transition-all duration-200',
        unavailable
          ? 'cursor-not-allowed opacity-55'
          : 'active:scale-[0.99] hover:border-line-strong hover:shadow-lift',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <div className="flex items-start gap-1.5">
            <h3 className="min-w-0 flex-1 font-sans text-[0.9375rem] font-semibold leading-snug text-ink transition-colors group-hover:text-accent-strong">
              {product.name}
            </h3>
          </div>

          {product.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">
              {product.description}
            </p>
          )}

          {/* Micro dietary and prep tags */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {product.popular && !unavailable && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                <Flame className="size-2.5 text-amber-600" />
                Popular
              </span>
            )}
            {isVeg && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                <Leaf className="size-2.5 text-emerald-600" />
                Veg
              </span>
            )}
            {isSpicy && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20">
                <Flame className="size-2.5 text-rose-600" />
                Spicy
              </span>
            )}
            {product.prepTimeMinutes > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-600">
                <Clock className="size-2.5 text-stone-500" />
                ~{product.prepTimeMinutes}m
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-2">
          <p className="tabular text-[0.9375rem] font-bold text-ink">
            {product.variants.length > 0 && <span className="mr-1 text-xs font-normal text-ink-muted">from</span>}
            {money(fromPrice, currency)}
          </p>

          {product.ratingCount > 0 && (
            <p className="flex items-center gap-1 text-[11px] font-medium text-ink-muted">
              <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
              <span className="tabular font-semibold text-ink-soft">{product.rating.toFixed(1)}</span>
              <span>({product.ratingCount})</span>
            </p>
          )}
        </div>
      </div>

      {/* Right side locked food image container with floating quick-add */}
      <div className="relative size-[5.75rem] sm:size-24 shrink-0 overflow-hidden rounded-2xl shadow-xs ring-1 ring-black/5">
        <FoodImage
          name={product.name}
          src={product.imageUrl}
          rounded="rounded-2xl"
          className={cn(unavailable && 'grayscale contrast-90')}
        />

        {unavailable ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-1 text-center backdrop-blur-xs">
            <span className="rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-900 shadow-sm">
              Sold out
            </span>
          </div>
        ) : (
          <div className="absolute bottom-1.5 right-1.5 z-10">
            {cartCount > 0 ? (
              <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-white shadow-lift ring-2 ring-white transition-transform active:scale-90">
                {cartCount}
              </span>
            ) : (
              <span className="flex size-7 items-center justify-center rounded-full bg-white/95 text-ink shadow-lift backdrop-blur-xs transition-all active:scale-90 ring-1 ring-black/5 group-hover:bg-accent group-hover:text-white">
                <Plus className="size-3.5" strokeWidth={2.5} />
              </span>
            )}
          </div>
        )}
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
      <div className="mb-2.5 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Sparkles className="size-3.5" aria-hidden />
          </span>
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink-soft">Chef's highlights</h2>
        </div>
        <span className="text-2xs font-medium text-ink-muted">Handcrafted specials</span>
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pb-2">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => onOpen(product)}
            className="group w-[15.5rem] shrink-0 snap-start overflow-hidden rounded-2xl border border-line/75 bg-surface text-left shadow-subtle transition-all active:scale-[0.98] hover:border-line-strong hover:shadow-lift"
          >
            <div className="relative aspect-[16/10] w-full overflow-hidden">
              <FoodImage
                name={product.name}
                src={product.imageUrl}
                rounded="rounded-none"
                className="transition-transform duration-500 ease-out group-hover:scale-105"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-neutral-900 shadow-xs backdrop-blur-md">
                <Sparkles className="size-2.5 text-amber-600" />
                Special
              </div>
              {product.prepTimeMinutes > 0 && (
                <div className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-md">
                  ~{product.prepTimeMinutes}m
                </div>
              )}
              <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-baseline justify-between text-white">
                <span className="tabular font-display text-base font-bold drop-shadow-sm">
                  {money(product.basePrice, currency)}
                </span>
                {product.ratingCount > 0 && (
                  <span className="flex items-center gap-1 text-[11px] font-medium drop-shadow-sm">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    {product.rating.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
            <div className="p-3">
              <h3 className="truncate font-sans text-sm font-semibold text-ink group-hover:text-accent-strong transition-colors">
                {product.name}
              </h3>
              {product.description && (
                <p className="mt-1 line-clamp-1 text-xs text-ink-muted">{product.description}</p>
              )}
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
  const lastProductRef = useRef<MenuProduct | null>(null);
  if (product) {
    lastProductRef.current = product;
  }
  const displayProduct = product ?? lastProductRef.current;

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
    if (!displayProduct) return 0;
    const variant = displayProduct.variants.find((v) => v.id === selection.variantId);
    const modifiers = displayProduct.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => selection.optionIds.has(option.id))
      .reduce((sum, option) => sum + option.priceDelta, 0);
    return displayProduct.basePrice + (variant?.priceDelta ?? 0) + modifiers;
  }, [displayProduct, selection]);

  const groupErrors = useMemo(() => {
    if (!displayProduct) return new Map<string, string>();
    const errors = new Map<string, string>();
    for (const group of displayProduct.modifierGroups) {
      const chosen = group.options.filter((option) => selection.optionIds.has(option.id)).length;
      const min = group.required ? Math.max(1, group.minSelect) : group.minSelect;
      const max = group.selectionType === 'SINGLE' ? 1 : (group.maxSelect ?? group.options.length);
      if (chosen < min) errors.set(group.id, `Choose at least ${min}`);
      else if (chosen > max) errors.set(group.id, `Choose at most ${max}`);
    }
    return errors;
  }, [displayProduct, selection]);

  if (!displayProduct) return null;

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

    const variant = displayProduct.variants.find((v) => v.id === selection.variantId) ?? null;
    const chosen = displayProduct.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => selection.optionIds.has(option.id));

    onAdd({
      productId: displayProduct.id,
      productName: displayProduct.name,
      imageUrl: displayProduct.imageUrl,
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
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onClose}
            aria-label="Back to menu"
            className="shrink-0 px-3.5 text-ink hover:bg-stone-100"
          >
            <ArrowLeft className="mr-1.5 size-4" />
            <span className="text-xs font-semibold">Back</span>
          </Button>
          <QuantityStepper
            value={selection.quantity}
            onChange={(quantity) => setSelection((current) => ({ ...current, quantity }))}
          />
          <Button
            size="lg"
            fullWidth
            onClick={handleAdd}
            className="flex-1 bg-accent hover:bg-accent-strong text-white shadow-lift active:scale-[0.98] transition-transform"
          >
            <span>Add to cart</span>
            <span className="tabular ml-auto font-bold">
              {money(unitPrice * selection.quantity, currency)}
            </span>
          </Button>
        </div>
      }
    >
      <div className="relative h-60 w-full sm:h-72">
        <FoodImage name={displayProduct.name} src={displayProduct.imageUrl} rounded="rounded-none" eager />

        {/* Ambient dark gradient overlays for controls */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 via-black/20 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />

        {/* Top-left "Back to menu" button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to menu"
          className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-neutral-900 shadow-md backdrop-blur-md transition-all active:scale-95 hover:bg-white"
        >
          <ArrowLeft className="size-4" strokeWidth={2.4} />
          <span>Back</span>
        </button>

        {/* Top-right "Close" button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-20 flex size-8 items-center justify-center rounded-full bg-white/95 text-neutral-900 shadow-md backdrop-blur-md transition-all active:scale-95 hover:bg-white"
        >
          <X className="size-4" strokeWidth={2.4} />
        </button>
      </div>

      <div className="px-5 pb-6 pt-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-[1.375rem] font-bold leading-tight text-ink">{displayProduct.name}</h2>
          <p className="tabular shrink-0 text-xl font-bold text-ink">{money(displayProduct.basePrice, currency)}</p>
        </div>

        {displayProduct.description && (
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{displayProduct.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {displayProduct.popular && <Badge tone="gold" size="sm">Popular</Badge>}
          {displayProduct.tags.map((tag) => (
            <Badge key={tag} size="sm">{tag}</Badge>
          ))}
          {displayProduct.prepTimeMinutes > 0 && (
            <Badge size="sm" tone="neutral">~{displayProduct.prepTimeMinutes} min</Badge>
          )}
          {displayProduct.calories != null && <Badge size="sm">{displayProduct.calories} kcal</Badge>}
        </div>

        {displayProduct.allergens.length > 0 && (
          <div className="mt-3 rounded-xl bg-stone-100/70 px-3 py-2 text-xs text-ink-muted">
            <span className="font-semibold text-ink-soft">Allergens:</span> {displayProduct.allergens.join(', ')}
          </div>
        )}

        {displayProduct.variants.length > 0 && (
          <OptionGroup
            title="Choose an option"
            required
            error={null}
          >
            {displayProduct.variants.map((variant) => (
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

        {displayProduct.modifierGroups.map((group) => {
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
          <h3 className="mb-2 text-sm font-semibold text-ink">Special kitchen requests</h3>
          <Textarea
            value={selection.notes}
            onChange={(event) => setSelection((current) => ({ ...current, notes: event.target.value }))}
            placeholder="E.g., dressing on the side, extra crispy, no cutlery…"
            maxLength={280}
            rows={2}
            className="rounded-xl border-line/80 focus:border-accent"
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
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span>{title}</span>
          {required ? (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
              Required
            </span>
          ) : (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Optional
            </span>
          )}
        </h3>
        {hint && <span className="text-2xs text-ink-muted">{hint}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
      {error && <p className="mt-1.5 text-xs font-semibold text-danger">{error}</p>}
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
        'flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5 transition-all duration-150',
        disabled && 'cursor-not-allowed opacity-40',
        checked && !disabled
          ? 'border-accent bg-accent-soft/40 shadow-xs'
          : 'border-line/75 bg-surface hover:border-line-strong active:bg-stone-50',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex size-5 shrink-0 items-center justify-center">
          <input
            type={type}
            name={name}
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            className="peer sr-only"
          />
          <div
            className={cn(
              'flex size-5 items-center justify-center border transition-all',
              type === 'radio' ? 'rounded-full' : 'rounded-md',
              checked
                ? 'border-accent bg-accent text-white'
                : 'border-line-strong bg-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent',
            )}
          >
            {checked && <Check className="size-3.5 stroke-[3]" />}
          </div>
        </div>
        <span className="min-w-0 flex-1 text-sm font-medium text-ink">{label}</span>
      </div>

      <div className="flex items-center gap-2">
        {priceDelta !== 0 && (
          <span
            className={cn(
              'tabular rounded-full px-2 py-0.5 text-xs font-semibold',
              checked ? 'bg-accent/15 text-accent-strong' : 'bg-stone-100 text-ink-soft',
            )}
          >
            {priceDelta > 0 ? '+' : '−'}
            {money(Math.abs(priceDelta), currency)}
          </span>
        )}
        {disabled && <span className="text-2xs text-ink-muted">Unavailable</span>}
      </div>
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
        'flex shrink-0 items-center rounded-xl border border-line-strong/80 bg-surface shadow-xs',
        size === 'lg' ? 'h-12' : 'h-9',
      )}
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(min - 1, value - 1))}
        disabled={value <= min - 1}
        className={cn(
          'flex h-full items-center justify-center text-ink-soft transition-all hover:text-ink active:scale-90 disabled:opacity-30',
          size === 'lg' ? 'w-11' : 'w-8',
        )}
      >
        <Minus className={size === 'lg' ? 'size-4' : 'size-3.5'} strokeWidth={2.4} />
      </button>
      <span
        className={cn(
          'tabular min-w-7 text-center font-bold text-ink select-none',
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
          'flex h-full items-center justify-center text-ink-soft transition-all hover:text-ink active:scale-90 disabled:opacity-30',
          size === 'lg' ? 'w-11' : 'w-8',
        )}
      >
        <Plus className={size === 'lg' ? 'size-4' : 'size-3.5'} strokeWidth={2.4} />
      </button>
    </div>
  );
}
