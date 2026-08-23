import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UtensilsCrossed, X } from 'lucide-react';
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

export default function MenuPage() {
  const { data, currency } = useSession();
  const auth = useSessionAuth();
  const cart = useCart();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selected, setSelected] = useState<MenuProduct | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const query = useQuery({
    queryKey: ['customer', 'menu', data.branch.id],
    queryFn: () => api.get<MenuResponse>('/customer/menu', auth),
    staleTime: 2 * 60_000,
  });

  const menu = query.data;

  const filtered = useMemo(() => {
    if (!menu) return [];
    const term = debouncedSearch.trim().toLowerCase();
    return menu.products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        product.description?.toLowerCase().includes(term) ||
        product.tags.some((tag) => tag.toLowerCase().includes(term))
      );
    });
  }, [menu, categoryId, debouncedSearch]);

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

  const searching = debouncedSearch.trim().length > 0;

  return (
    <div className="mx-auto max-w-phone px-4 pb-40">
      <TableSessionBanner />

      {!data.openState.open && (
        <div className="mt-3 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3">
          <p className="text-sm font-medium text-danger">{data.restaurant.name} is currently closed</p>
          <p className="mt-1 text-xs leading-relaxed text-danger/80">
            You can browse the menu, but orders can only be placed during opening hours
            {data.openState.opensAt ? ` (from ${data.openState.opensAt})` : ''}.
          </p>
        </div>
      )}

      <div className="pb-2 pt-4">
        <h2 className="font-display text-[1.5rem] font-semibold leading-tight tracking-tight text-ink">
          What can we get you?
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Table {data.table.number} · tap any dish to customise it
        </p>
      </div>

      <div className="relative py-2">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search dishes, drinks…"
          className="h-11 rounded-lg pl-10 pr-10"
          aria-label="Search the menu"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-muted hover:bg-surface-sunken"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {menu && !searching && (
        <CategoryScroller categories={menu.categories} activeId={categoryId} onSelect={setCategoryId} />
      )}

      {query.isLoading && <LoadingCards count={4} className="mt-4 grid-cols-1 sm:grid-cols-1 lg:grid-cols-1" />}

      {query.isError && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} className="py-14" />
      )}

      {menu && (
        <>
          {!searching && !categoryId && featured.length > 0 && (
            <div className="-mx-4 mt-4">
              <FeaturedRail products={featured} currency={currency} onOpen={setSelected} />
            </div>
          )}

          {!searching && !categoryId && popular.length > 0 && (
            <Section title="Popular right now">
              {popular.map((product) => (
                <ProductCard key={product.id} product={product} currency={currency} onOpen={setSelected} />
              ))}
            </Section>
          )}

          {searching ? (
            filtered.length > 0 ? (
              <Section title={`${filtered.length} result${filtered.length === 1 ? '' : 's'}`}>
                {filtered.map((product) => (
                  <ProductCard key={product.id} product={product} currency={currency} onOpen={setSelected} />
                ))}
              </Section>
            ) : (
              <EmptyState
                icon={<Search className="size-5" />}
                title="Nothing matched that"
                description={`We couldn't find anything for "${debouncedSearch}". Try a different word.`}
                className="py-14"
              />
            )
          ) : (
            grouped.map(({ category, products }) => (
              <Section key={category.id} title={category.name} description={category.description}>
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} currency={currency} onOpen={setSelected} />
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
        product={selected}
        currency={currency}
        open={selected !== null}
        onClose={() => setSelected(null)}
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
        <h2 className="font-display text-[1.1875rem] font-semibold leading-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
