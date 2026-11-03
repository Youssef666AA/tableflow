import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Plus, UtensilsCrossed } from 'lucide-react';
import { ApiError, api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useDebounced, useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { money } from '@/lib/format';
import { Badge, Button, Input, Select } from '@/components/ui/primitives';
import { FilterBar } from '@/components/ui/data';
import { EmptyState, ErrorState, LoadingCards } from '@/components/ui/feedback';
import { Dialog, useToast } from '@/components/ui/overlays';
import { FoodImage } from '@/components/ui/food-image';
import { Page, PageHeading } from '@/console/PageShell';
import { ProductEditor } from '../components/ProductEditor';
import type { AdminMenuPayload, AdminProduct, AdminStation } from '../types';

export default function AdminMenuPage() {
  const { branchId, currency, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const debouncedSearch = useDebounced(search, 250);

  const menuQuery = useQuery({
    queryKey: ['menu', branchId],
    queryFn: () => api.get<AdminMenuPayload>(`/menu?branchId=${branchId}`),
    enabled: Boolean(branchId),
  });

  const stationsQuery = useQuery({
    queryKey: ['stations', branchId],
    queryFn: () => api.get<{ stations: AdminStation[] }>(`/kitchen/stations?branchId=${branchId}`),
    enabled: Boolean(branchId),
  });

  useRealtimeInvalidation(socket, ['menu:updated'], [['menu', branchId]]);

  const toggleAvailability = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'AVAILABLE' | 'UNAVAILABLE' }) =>
      api.patch(`/menu/products/${id}/availability`, { status, branchId }),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      toast.success(
        variables.status === 'AVAILABLE' ? 'Back on the menu' : "86'd for this branch",
        variables.status === 'AVAILABLE'
          ? 'Guests can order it again.'
          : 'Guests see it as currently unavailable.',
      );
    },
    onError: (error) =>
      toast.error('Could not update', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const createCategory = useMutation({
    mutationFn: () => api.post('/menu/categories', { name: newCategory.trim(), sortOrder: 99, active: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      setCategoryDialog(false);
      setNewCategory('');
      toast.success('Category created');
    },
    onError: (error) =>
      toast.error('Could not create', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const menu = menuQuery.data;

  const filtered = useMemo(() => {
    if (!menu) return [];
    const term = debouncedSearch.trim().toLowerCase();
    return menu.products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (statusFilter && product.status !== statusFilter) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        product.description?.toLowerCase().includes(term) ||
        product.tags.some((tag) => tag.includes(term))
      );
    });
  }, [menu, categoryId, statusFilter, debouncedSearch]);

  const grouped = useMemo(() => {
    if (!menu) return [];
    return menu.categories
      .map((category) => ({
        category,
        products: filtered.filter((product) => product.categoryId === category.id),
      }))
      .filter((group) => group.products.length > 0);
  }, [menu, filtered]);

  const openEditor = (product: AdminProduct | null) => {
    setEditing(product);
    setEditorOpen(true);
  };

  return (
    <Page>
      <PageHeading
        title="Menu"
        description="Categories, dishes, sizes and options. Changes reach guests immediately."
        actions={
          can('menu:manage') && (
            <>
              <Button variant="secondary" onClick={() => setCategoryDialog(true)}>
                New category
              </Button>
              <Button leadingIcon={<Plus className="size-4" />} onClick={() => openEditor(null)}>
                New item
              </Button>
            </>
          )
        }
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search the menu…"
        className="mb-5"
      >
        <Select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="w-44"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {menu?.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name} ({category.productCount})
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="w-40"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          <option value="AVAILABLE">Available</option>
          <option value="UNAVAILABLE">Unavailable</option>
          <option value="HIDDEN">Hidden</option>
        </Select>
      </FilterBar>

      {menuQuery.isLoading && <LoadingCards count={6} />}
      {menuQuery.isError && <ErrorState error={menuQuery.error} onRetry={() => void menuQuery.refetch()} />}

      {menu && grouped.length === 0 && (
        <EmptyState
          icon={<UtensilsCrossed className="size-5" />}
          title="Nothing matches"
          description="Try a different search or clear the filters."
        />
      )}

      <div className="space-y-8">
        {grouped.map(({ category, products }) => (
          <section key={category.id}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div>
                <h3 className="text-[0.9375rem] font-semibold text-ink">{category.name}</h3>
                {category.description && (
                  <p className="mt-0.5 text-xs text-ink-muted">{category.description}</p>
                )}
              </div>
              <span className="tabular text-xs text-ink-muted">{products.length} items</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {products.map((product) => (
                <article
                  key={product.id}
                  className={cn(
                    'group flex flex-col overflow-hidden rounded-lg border bg-surface shadow-subtle transition-all hover:shadow-lift',
                    product.status === 'AVAILABLE' ? 'border-line' : 'border-line opacity-75',
                  )}
                >
                  <button
                    onClick={() => can('menu:manage') && openEditor(product)}
                    className="flex flex-1 flex-col text-left"
                    disabled={!can('menu:manage')}
                  >
                    <div className="relative h-28 w-full overflow-hidden">
                      <FoodImage name={product.name} src={product.imageUrl} rounded="rounded-none" />
                      {product.status !== 'AVAILABLE' && (
                        <span className="absolute inset-0 flex items-center justify-center bg-ink/50 text-2xs font-semibold uppercase tracking-wider text-white">
                          {product.status === 'HIDDEN' ? 'Hidden' : "86'd"}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink">
                          {product.name}
                        </h4>
                        <span className="tabular shrink-0 text-sm font-semibold text-ink">
                          {money(product.basePrice, currency)}
                        </span>
                      </div>

                      {product.description && (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                          {product.description}
                        </p>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {product.popular && <Badge size="sm" tone="gold">Popular</Badge>}
                        {product.featured && <Badge size="sm" tone="accent">Chef's pick</Badge>}
                        {product.kitchenStation && (
                          <Badge size="sm">{product.kitchenStation.name}</Badge>
                        )}
                        {product.variants.length > 0 && (
                          <Badge size="sm">{product.variants.length} sizes</Badge>
                        )}
                        {product.modifierGroups.length > 0 && (
                          <Badge size="sm">{product.modifierGroups.length} option groups</Badge>
                        )}
                      </div>

                      <p className="tabular mt-auto pt-2.5 text-2xs text-ink-muted">
                        {product.soldCount} sold · {product.prepTimeMinutes} min
                        {product.ratingCount > 0 && ` · ★ ${product.rating.toFixed(1)}`}
                      </p>
                    </div>
                  </button>

                  {can('menu:manage') && (
                    <div className="border-t border-line px-3 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        fullWidth
                        className="justify-start"
                        leadingIcon={<EyeOff className="size-3.5" />}
                        loading={toggleAvailability.isPending && toggleAvailability.variables?.id === product.id}
                        onClick={() =>
                          toggleAvailability.mutate({
                            id: product.id,
                            status: product.status === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
                          })
                        }
                      >
                        {product.status === 'AVAILABLE' ? "86 item" : 'Make available'}
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <ProductEditor
        product={editing}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        categories={menu?.categories ?? []}
        stations={stationsQuery.data?.stations ?? []}
      />

      <Dialog
        open={categoryDialog}
        onClose={() => setCategoryDialog(false)}
        title="New category"
        description="Categories group the menu for guests."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCategoryDialog(false)}>
              Cancel
            </Button>
            <Button
              loading={createCategory.isPending}
              disabled={newCategory.trim().length === 0}
              onClick={() => createCategory.mutate()}
            >
              Create
            </Button>
          </div>
        }
      >
        <Input
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value)}
          placeholder="Sides"
          aria-label="Category name"
        />
      </Dialog>
    </Page>
  );
}
