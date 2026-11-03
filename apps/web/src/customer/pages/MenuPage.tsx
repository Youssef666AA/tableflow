import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flame, Leaf, Search, Sparkles, UtensilsCrossed, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { Input } from '@/components/ui/primitives';
import { EmptyState, ErrorState, LoadingCards } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';
import { CategoryScroller, FeaturedRail, ProductCard, ProductSheet } from '../components/menu';
import { TableSessionBanner } from '../components/shell';
import { useCart } from '../cart';
import { useSession, useSessionAuth } from '../session';
import type { MenuProduct, MenuResponse } from '../types';

type DietaryFilter = 'all' | 'popular' | 'featured' | 'vegetarian' | 'spicy';

const DIETARY_FILTERS: Array<{ id: DietaryFilter; label: string; icon?: typeof Flame }> = [
  { id: 'all', label: 'All' },
  { id: 'popular', label: 'Popular', icon: Flame },
  { id: 'featured', label: "Chef's Pick", icon: Sparkles },
  { id: 'vegetarian', label: 'Vegetarian', icon: Leaf },
  { id: 'spicy', label: 'Spicy', icon: Flame },
];

export default function MenuPage() {
  const { data, currency } = useSession();
  const auth = useSessionAuth();
  const cart = useCart();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dietary, setDietary] = useState<DietaryFilter>('all');

  const debouncedSearch = useDebounced(search, 250);

  const query = useQuery({
    queryKey: ['customer', 'menu', data.branch.id],
    queryFn: () => api.get<MenuResponse>('/customer/menu', auth),
    staleTime: 2 * 60_000,
  });

  const menu = query.data;

  // Track item counts in cart so dish cards can display dynamic active counts
  const itemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const line of cart.lines) {
      counts[line.productId] = (counts[line.productId] ?? 0) + line.quantity;
    }
    return counts;
  }, [cart.lines]);

  // Track selected product via URL search param (?dish=id) so the phone's native hardware/browser Back button
  // closes the product view and restores the previous menu UI instead of leaving the page.
  const selectedDishId = searchParams.get('dish');
  const [activeProduct, setActiveProduct] = useState<MenuProduct | null>(null);

  useEffect(() => {
    if (!selectedDishId) {
      setActiveProduct(null);
    } else if (menu) {
      const match = menu.products.find((p) => p.id === selectedDishId);
      if (match) setActiveProduct(match);
    }
  }, [selectedDishId, menu]);

  const handleOpenProduct = (product: MenuProduct) => {
    setActiveProduct(product);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('dish', product.id);
        return next;
      },
      { replace: false },
    );
  };

  const handleCloseProduct = () => {
    setActiveProduct(null);
    if (searchParams.has('dish')) {
      if (window.history.state && window.history.state.idx > 0) {
        window.history.back();
      } else {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete('dish');
            return next;
          },
          { replace: true },
        );
      }
    }
  };

  const filtered = useMemo(() => {
    if (!menu) return [];
    const term = debouncedSearch.trim().toLowerCase();
    return menu.products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;

      // Dietary filter check
      if (dietary === 'popular' && !product.popular) return false;
      if (dietary === 'featured' && !product.featured) return false;
      if (dietary === 'vegetarian' && !product.tags.some((t) => /veg/i.test(t))) return false;
      if (dietary === 'spicy' && !product.tags.some((t) => /spic/i.test(t))) return false;

      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        product.description?.toLowerCase().includes(term) ||
        product.tags.some((tag) => tag.toLowerCase().includes(term))
      );
    });
  }, [menu, categoryId, dietary, debouncedSearch]);

  const grouped = useMemo(() => {
    if (!menu) return [];
    return menu.categories
      .map((category) => ({
        category,
        products: filtered.filter((product) => product.categoryId === category.id),
      }))
      .filter((group) => group.products.length > 0);
  }, [menu, filtered]);

  const popular = useMemo(
    () => (menu?.products ?? []).filter((p) => p.popular && p.status === 'AVAILABLE').slice(0, 8),
    [menu],
  );
  const featured = useMemo(
    () => (menu?.products ?? []).filter((p) => p.featured && p.status === 'AVAILABLE').slice(0, 8),
    [menu],
  );

  const searching = debouncedSearch.trim().length > 0 || dietary !== 'all';

  return (
    <div className="mx-auto max-w-phone px-4 pb-44">
      <TableSessionBanner />

      {!data.openState.open && (
        <div className="mt-3 rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3">
          <p className="text-sm font-semibold text-danger">{data.restaurant.name} is currently closed</p>
          <p className="mt-1 text-xs leading-relaxed text-danger/80">
            You can browse the menu, but orders can only be placed during opening hours
            {data.openState.opensAt ? ` (from ${data.openState.opensAt})` : ''}.
          </p>
        </div>
      )}

      {/* Editorial greeting header */}
      <div className="pb-3 pt-5">
        <h2 className="font-display text-[1.625rem] font-bold leading-tight tracking-tight text-ink">
          What can we get you?
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Table {data.table.number} · tap any dish to customise options
        </p>
      </div>

      {/* Search Input Bar */}
      <div className="relative py-1.5">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search dishes, drinks, ingredients…"
          className="h-11 rounded-2xl bg-white pl-10 pr-10 shadow-xs focus:ring-accent/40"
          aria-label="Search the menu"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-muted transition-colors hover:bg-stone-100"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Dietary filter pills strip */}
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 py-2">
        {DIETARY_FILTERS.map((item) => {
          const active = dietary === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setDietary(item.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                active
                  ? 'bg-accent text-white shadow-xs'
                  : 'bg-white text-ink-muted ring-1 ring-inset ring-line/80 hover:bg-stone-50 hover:text-ink'
              }`}
            >
              {Icon && <Icon className={`size-3 ${active ? 'text-white' : 'text-ink-muted'}`} />}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {menu && debouncedSearch.trim().length === 0 && (
        <CategoryScroller categories={menu.categories} activeId={categoryId} onSelect={setCategoryId} />
      )}

      {query.isLoading && <LoadingCards count={4} className="mt-4 grid-cols-1 sm:grid-cols-1 lg:grid-cols-1" />}

      {query.isError && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} className="py-14" />
      )}

      {menu && (
        <>
          {!searching && !categoryId && featured.length > 0 && (
            <div className="-mx-4 mt-3">
              <FeaturedRail products={featured} currency={currency} onOpen={handleOpenProduct} />
            </div>
          )}

          {!searching && !categoryId && popular.length > 0 && (
            <Section title="Popular right now">
              {popular.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  currency={currency}
                  onOpen={handleOpenProduct}
                  cartCount={itemCounts[product.id] ?? 0}
                />
              ))}
            </Section>
          )}

          {searching ? (
            filtered.length > 0 ? (
              <Section title={`${filtered.length} result${filtered.length === 1 ? '' : 's'}`}>
                {filtered.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    currency={currency}
                    onOpen={handleOpenProduct}
                    cartCount={itemCounts[product.id] ?? 0}
                  />
                ))}
              </Section>
            ) : (
              <EmptyState
                icon={<Search className="size-5" />}
                title="Nothing matched that"
                description={`We couldn't find anything matching your filter. Try adjusting your query.`}
                className="py-14"
              />
            )
          ) : (
            grouped.map(({ category, products }) => (
              <Section key={category.id} title={category.name} description={category.description}>
                {products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    currency={currency}
                    onOpen={handleOpenProduct}
                    cartCount={itemCounts[product.id] ?? 0}
                  />
                ))}
              </Section>
            ))
          )}

          {!searching && grouped.length === 0 && !query.isLoading && (
            <EmptyState
              icon={<UtensilsCrossed className="size-5" />}
              title="The menu is being updated"
              description="Nothing is available in this section right now. Please check back shortly."
              className="py-14"
            />
          )}
        </>
      )}

      <ProductSheet
        product={activeProduct}
        currency={currency}
        open={activeProduct !== null}
        onClose={handleCloseProduct}
        onAdd={(line) => {
          cart.add(line);
          toast.success(`${line.quantity} × ${line.productName} added`, 'Tap the cart when you are ready.');
        }}
      />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-6">
      <div className="mb-3">
        <h2 className="font-display text-[1.25rem] font-bold leading-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
