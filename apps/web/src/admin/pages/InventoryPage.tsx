import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownUp, PackagePlus, Plus } from 'lucide-react';
import { STOCK_LEVEL_LABEL, UNITS, WASTE_REASONS } from '@tableflow/shared';
import { ApiError, api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatQuantity, money, relativeTime, titleCase } from '@/lib/format';
import { useDebounced, useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Badge, Button, Field, Input, SegmentedControl, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, FilterBar, StatCard, type Column } from '@/components/ui/data';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Dialog, useToast } from '@/components/ui/overlays';
import { Page, PageHeading, SectionHeading } from '@/console/PageShell';
import type { AdminInventoryItem } from '../types';

interface InventoryPayload {
  branchId: string;
  items: AdminInventoryItem[];
  summary: { total: number; lowStock: number; outOfStock: number; stockValue: number };
  alerts: Array<{
    id: string;
    level: 'LOW_STOCK' | 'OUT_OF_STOCK';
    message: string;
    createdAt: string;
    item: { id: string; name: string; unit: string };
  }>;
}

interface Movement {
  id: string;
  type: string;
  item: { id: string; name: string; unit: string };
  quantity: number;
  unit: string;
  balanceAfter: number;
  reason: string | null;
  wasteReason: string | null;
  totalCost: number;
  orderNumber: number | null;
  user: string | null;
  createdAt: string;
}

const LEVEL_TONES = {
  OK: 'success',
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'danger',
} as const;

export default function InventoryPage() {
  const { branchId, currency, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());

  const [tab, setTab] = useState<'stock' | 'movements'>('stock');
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [movementFor, setMovementFor] = useState<AdminInventoryItem | null>(null);
  const [newItemOpen, setNewItemOpen] = useState(false);

  const debouncedSearch = useDebounced(search, 250);

  const inventoryQuery = useQuery({
    queryKey: ['inventory', branchId, debouncedSearch, levelFilter],
    queryFn: () =>
      api.get<InventoryPayload>(
        `/inventory?branchId=${branchId}` +
          (debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : '') +
          (levelFilter ? `&level=${levelFilter}` : ''),
      ),
    enabled: Boolean(branchId),
  });

  const movementsQuery = useQuery({
    queryKey: ['inventory', 'movements', branchId],
    queryFn: () =>
      api.get<{ movements: Movement[] }>(`/inventory/movements?branchId=${branchId}&pageSize=50`),
    enabled: Boolean(branchId) && tab === 'movements',
  });

  useRealtimeInvalidation(socket, ['inventory:alert'], [['inventory', branchId]]);

  const data = inventoryQuery.data;

  const columns: Column<AdminInventoryItem>[] = [
    {
      key: 'name',
      header: 'Ingredient',
      render: (item) => (
        <div>
          <p className="font-medium text-ink">{item.name}</p>
          <p className="text-2xs text-ink-muted">
            {item.category ?? 'Uncategorised'}
            {item.supplier ? ` · ${item.supplier.name}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'On hand',
      align: 'right',
      render: (item) => (
        <span className="tabular font-medium text-ink">{formatQuantity(item.quantity, item.unit)}</span>
      ),
    },
    {
      key: 'minimum',
      header: 'Minimum',
      align: 'right',
      hideOnMobile: true,
      render: (item) => (
        <span className="tabular text-ink-muted">{formatQuantity(item.minimumQuantity, item.unit)}</span>
      ),
    },
    {
      key: 'level',
      header: 'Status',
      render: (item) => (
        <Badge tone={LEVEL_TONES[item.level]} size="sm" dot>
          {STOCK_LEVEL_LABEL[item.level]}
        </Badge>
      ),
    },
    {
      key: 'value',
      header: 'Stock value',
      align: 'right',
      hideOnMobile: true,
      render: (item) => <span className="tabular text-ink-soft">{money(item.stockValue, currency)}</span>,
    },
    {
      key: 'updated',
      header: 'Updated',
      align: 'right',
      hideOnMobile: true,
      render: (item) => <span className="text-2xs text-ink-muted">{relativeTime(item.updatedAt)}</span>,
    },
  ];

  const movementColumns: Column<Movement>[] = [
    {
      key: 'created',
      header: 'When',
      render: (movement) => (
        <div>
          <p className="text-ink">{relativeTime(movement.createdAt)}</p>
          <p className="text-2xs text-ink-muted">{movement.user ?? 'system'}</p>
        </div>
      ),
    },
    { key: 'item', header: 'Ingredient', render: (movement) => <span className="text-ink">{movement.item.name}</span> },
    {
      key: 'type',
      header: 'Type',
      render: (movement) => (
        <Badge
          size="sm"
          tone={
            movement.type === 'WASTE'
              ? 'danger'
              : movement.type === 'PURCHASE'
                ? 'success'
                : movement.type === 'SALE'
                  ? 'info'
                  : 'neutral'
          }
        >
          {titleCase(movement.type)}
        </Badge>
      ),
    },
    {
      key: 'quantity',
      header: 'Change',
      align: 'right',
      render: (movement) => (
        <span
          className={cn(
            'tabular font-medium',
            movement.quantity > 0 ? 'text-success' : movement.quantity < 0 ? 'text-danger' : 'text-ink',
          )}
        >
          {movement.quantity > 0 ? '+' : ''}
          {formatQuantity(movement.quantity, movement.unit)}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      hideOnMobile: true,
      render: (movement) => (
        <span className="tabular text-ink-muted">{formatQuantity(movement.balanceAfter, movement.unit)}</span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      hideOnMobile: true,
      render: (movement) => (
        <span className="text-xs text-ink-muted">
          {movement.wasteReason ? titleCase(movement.wasteReason) : (movement.reason ?? '—')}
          {movement.orderNumber ? ` · #${movement.orderNumber}` : ''}
        </span>
      ),
    },
  ];

  return (
    <Page>
      <PageHeading
        title="Inventory"
        description="Every gram is tracked through a ledger — recipes deduct automatically when orders are placed."
        actions={
          <div className="flex flex-wrap gap-2">
            <SegmentedControl
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'stock', label: 'Stock' },
                { value: 'movements', label: 'Movements' },
              ]}
            />
            {can('inventory:manage') && (
              <Button size="sm" leadingIcon={<Plus className="size-3.5" />} onClick={() => setNewItemOpen(true)}>
                New ingredient
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ingredients tracked" value={data?.summary.total ?? 0} loading={inventoryQuery.isLoading} />
        <StatCard
          label="Low stock"
          value={data?.summary.lowStock ?? 0}
          tone={(data?.summary.lowStock ?? 0) > 0 ? 'warning' : 'neutral'}
          icon={<AlertTriangle className="size-4" />}
          loading={inventoryQuery.isLoading}
        />
        <StatCard
          label="Out of stock"
          value={data?.summary.outOfStock ?? 0}
          tone={(data?.summary.outOfStock ?? 0) > 0 ? 'danger' : 'neutral'}
          loading={inventoryQuery.isLoading}
        />
        <StatCard
          label="Stock value"
          value={money(data?.summary.stockValue ?? 0, currency)}
          icon={<PackagePlus className="size-4" />}
          loading={inventoryQuery.isLoading}
        />
      </div>

      {(data?.alerts.length ?? 0) > 0 && (
        <section className="mb-5">
          <SectionHeading title="Open alerts" description="Raised automatically when stock crosses a threshold" />
          <div className="flex flex-wrap gap-2">
            {data?.alerts.map((alert) => (
              <span
                key={alert.id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
                  alert.level === 'OUT_OF_STOCK'
                    ? 'border-danger/30 bg-danger-soft text-danger'
                    : 'border-warning/30 bg-warning-soft text-warning',
                )}
              >
                <AlertTriangle className="size-3" aria-hidden />
                {alert.message}
              </span>
            ))}
          </div>
        </section>
      )}

      {tab === 'stock' ? (
        <>
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search ingredients…"
            className="mb-4"
          >
            <Select
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value)}
              className="w-40"
              aria-label="Filter by stock level"
            >
              <option value="">Any level</option>
              <option value="OK">In stock</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="OUT_OF_STOCK">Out of stock</option>
            </Select>
          </FilterBar>

          {inventoryQuery.isError ? (
            <ErrorState error={inventoryQuery.error} onRetry={() => void inventoryQuery.refetch()} />
          ) : (
            <DataTable
              columns={columns}
              rows={data?.items ?? []}
              rowKey={(item) => item.id}
              loading={inventoryQuery.isLoading}
              onRowClick={can('inventory:waste') ? setMovementFor : undefined}
              empty={
                <EmptyState
                  icon={<PackagePlus className="size-5" />}
                  title="No ingredients yet"
                  description="Add ingredients and link them to recipes so stock moves by itself."
                  compact
                />
              }
            />
          )}
        </>
      ) : (
        <DataTable
          columns={movementColumns}
          rows={movementsQuery.data?.movements ?? []}
          rowKey={(movement) => movement.id}
          loading={movementsQuery.isLoading}
          dense
          empty={
            <EmptyState
              icon={<ArrowDownUp className="size-5" />}
              title="No movements yet"
              description="Purchases, sales, waste and adjustments all appear here."
              compact
            />
          }
        />
      )}

      <MovementDialog
        item={movementFor}
        open={movementFor !== null}
        onClose={() => setMovementFor(null)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['inventory'] });
          setMovementFor(null);
        }}
      />

      <NewIngredientDialog
        open={newItemOpen}
        onClose={() => setNewItemOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['inventory'] });
          setNewItemOpen(false);
          toast.success('Ingredient added');
        }}
      />
    </Page>
  );
}

/* -------------------------------------------------------- MovementDialog */

function MovementDialog({
  item,
  open,
  onClose,
  onSaved,
}: {
  item: AdminInventoryItem | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [type, setType] = useState<'PURCHASE' | 'WASTE' | 'ADJUSTMENT' | 'RETURN'>('WASTE');
  const [quantity, setQuantity] = useState('');
  const [wasteReason, setWasteReason] = useState('EXPIRED');
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post('/inventory/movements', {
        inventoryItemId: item?.id,
        type,
        quantity: Number(quantity.replace(',', '.') || '0'),
        unit: item?.unit,
        reason: reason.trim() || null,
        wasteReason: type === 'WASTE' ? wasteReason : null,
      }),
    onSuccess: () => {
      setQuantity('');
      setReason('');
      onSaved();
      toast.success('Stock updated');
    },
    onError: (error) =>
      toast.error(
        'Could not record that',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  if (!item) return null;

  const availableTypes = can('inventory:manage')
    ? (['PURCHASE', 'WASTE', 'ADJUSTMENT', 'RETURN'] as const)
    : (['WASTE'] as const);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item.name}
      description={`${formatQuantity(item.quantity, item.unit)} on hand`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!quantity} onClick={() => save.mutate()}>
            Record movement
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Movement type" htmlFor="m-type">
          <Select id="m-type" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            {availableTypes.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={`Quantity (${item.unit})`}
          htmlFor="m-quantity"
          description={type === 'ADJUSTMENT' ? 'Use a negative number to reduce stock.' : undefined}
        >
          <Input
            id="m-quantity"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="2.5"
            className="tabular"
          />
        </Field>

        {type === 'WASTE' && (
          <Field label="Reason" htmlFor="m-waste">
            <Select id="m-waste" value={wasteReason} onChange={(event) => setWasteReason(event.target.value)}>
              {WASTE_REASONS.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Note" htmlFor="m-note" hint="optional">
          <Textarea
            id="m-note"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder="Delivery reference, what happened…"
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------- NewIngredientDialog */

function NewIngredientDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { branchId, currency } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<(typeof UNITS)[number]>('kg');
  const [quantity, setQuantity] = useState('0');
  const [minimum, setMinimum] = useState('0');
  const [cost, setCost] = useState('0');
  const [category, setCategory] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post('/inventory/items', {
        branchId,
        name: name.trim(),
        unit,
        quantity: Number(quantity.replace(',', '.') || '0'),
        minimumQuantity: Number(minimum.replace(',', '.') || '0'),
        costPerUnit: Math.round(Number(cost.replace(',', '.') || '0') * 1000),
        category: category.trim() || null,
      }),
    onSuccess: () => {
      setName('');
      setQuantity('0');
      setMinimum('0');
      setCost('0');
      setCategory('');
      onSaved();
    },
    onError: (error) =>
      toast.error('Could not add', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New ingredient"
      description="Tracked in inventory, deducted by recipes."
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Add ingredient
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="i-name" required>
          <Input id="i-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Beef mince" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit" htmlFor="i-unit">
            <Select id="i-unit" value={unit} onChange={(event) => setUnit(event.target.value as typeof unit)}>
              {UNITS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="i-category" hint="optional">
            <Input
              id="i-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Meat"
            />
          </Field>
          <Field label="Opening quantity" htmlFor="i-quantity">
            <Input
              id="i-quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="tabular"
            />
          </Field>
          <Field label="Minimum" htmlFor="i-minimum">
            <Input
              id="i-minimum"
              inputMode="decimal"
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
              className="tabular"
            />
          </Field>
          <Field
            label={`Cost per ${unit} (${currency})`}
            htmlFor="i-cost"
            className="col-span-2"
          >
            <Input
              id="i-cost"
              inputMode="decimal"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              className="tabular"
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
