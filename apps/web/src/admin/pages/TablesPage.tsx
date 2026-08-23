import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Map, Move, Plus, Save, Table2 } from 'lucide-react';
import type { TableStatus } from '@tableflow/shared';
import { ApiError, api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Button, Field, Input, SegmentedControl, Select, Spinner, Switch } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { SidePanel, useToast } from '@/components/ui/overlays';
import { Page, PageHeading } from '@/console/PageShell';
import { FloorLegend, FloorPlan, TableCard, type FloorTable } from '@/staff/components/floor';
import { TableDetailPanel } from '@/staff/components/TableDetailPanel';

interface TablesPayload {
  branchId: string;
  tables: FloorTable[];
}

interface Draft {
  number: string;
  label: string;
  seats: string;
  zone: string;
  shape: 'ROUND' | 'SQUARE' | 'RECT';
  outOfService: boolean;
}

const EMPTY_DRAFT: Draft = {
  number: '',
  label: '',
  seats: '4',
  zone: '',
  shape: 'ROUND',
  outOfService: false,
};

export default function AdminTablesPage() {
  const { branchId, currency, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());

  const [view, setView] = useState<'plan' | 'grid'>('plan');
  const [arranging, setArranging] = useState(false);
  const [pending, setPending] = useState<Record<string, { posX: number; posY: number }>>({});
  const [selected, setSelected] = useState<FloorTable | null>(null);
  const [editing, setEditing] = useState<FloorTable | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const query = useQuery({
    queryKey: ['tables', branchId],
    queryFn: () => api.get<TablesPayload>(`/tables?branchId=${branchId}`),
    enabled: Boolean(branchId),
  });

  useRealtimeInvalidation(
    socket,
    ['table:updated', 'session:updated', 'order:created', 'order:updated'],
    [['tables', branchId]],
  );

  const savePositions = useMutation({
    mutationFn: () =>
      api.post(`/tables/positions?branchId=${branchId}`, {
        tables: Object.entries(pending).map(([id, position]) => ({ id, ...position })),
      }),
    onSuccess: () => {
      setPending({});
      setArranging(false);
      void queryClient.invalidateQueries({ queryKey: ['tables', branchId] });
      toast.success('Floor plan saved');
    },
    onError: (error) =>
      toast.error('Could not save the layout', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const saveTable = useMutation({
    mutationFn: () => {
      const body = {
        number: draft.number.trim(),
        label: draft.label.trim() || null,
        seats: Number(draft.seats) || 4,
        zone: draft.zone.trim() || null,
        shape: draft.shape,
        ...(editing ? { outOfService: draft.outOfService } : { branchId, posX: 50, posY: 50 }),
      };
      return editing ? api.put(`/tables/${editing.id}`, body) : api.post('/tables', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tables', branchId] });
      setEditorOpen(false);
      toast.success(editing ? 'Table updated' : 'Table added', editing ? undefined : 'A QR code was generated for it.');
    },
    onError: (error) =>
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const removeTable = useMutation({
    mutationFn: () => api.del(`/tables/${editing?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tables', branchId] });
      setEditorOpen(false);
      toast.success('Table removed');
    },
    onError: (error) =>
      toast.error('Could not remove', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const tables = useMemo(() => {
    const rows = query.data?.tables ?? [];
    if (Object.keys(pending).length === 0) return rows;
    return rows.map((table) => (pending[table.id] ? { ...table, ...pending[table.id] } : table));
  }, [query.data, pending]);

  const counts = useMemo(() => {
    const result: Partial<Record<TableStatus, number>> = {};
    tables.forEach((table) => {
      result[table.status] = (result[table.status] ?? 0) + 1;
    });
    return result;
  }, [tables]);

  const openEditor = (table: FloorTable | null) => {
    setEditing(table);
    setDraft(
      table
        ? {
            number: table.number,
            label: table.label ?? '',
            seats: String(table.seats),
            zone: table.zone ?? '',
            shape: table.shape,
            outOfService: table.outOfService,
          }
        : EMPTY_DRAFT,
    );
    setEditorOpen(true);
  };

  const selectedLive = selected ? (tables.find((table) => table.id === selected.id) ?? selected) : null;

  return (
    <Page>
      <PageHeading
        title="Tables"
        description="The room, its live state and the layout guests are seated in."
        actions={
          <div className="flex flex-wrap gap-2">
            <SegmentedControl
              size="sm"
              value={view}
              onChange={(next) => {
                setView(next);
                if (next === 'grid') setArranging(false);
              }}
              options={[
                { value: 'plan', label: <span className="inline-flex items-center gap-1.5"><Map className="size-3.5" />Plan</span> },
                { value: 'grid', label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" />Grid</span> },
              ]}
            />
            {can('tables:manage') && view === 'plan' && (
              arranging ? (
                <>
                  <Button
                    size="sm"
                    loading={savePositions.isPending}
                    disabled={Object.keys(pending).length === 0}
                    leadingIcon={<Save className="size-3.5" />}
                    onClick={() => savePositions.mutate()}
                  >
                    Save layout
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPending({});
                      setArranging(false);
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Move className="size-3.5" />}
                  onClick={() => setArranging(true)}
                >
                  Arrange
                </Button>
              )
            )}
            {can('tables:manage') && (
              <Button size="sm" leadingIcon={<Plus className="size-3.5" />} onClick={() => openEditor(null)}>
                Add table
              </Button>
            )}
          </div>
        }
      />

      {query.isLoading && (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      )}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && tables.length === 0 && (
        <EmptyState
          icon={<Table2 className="size-5" />}
          title="No tables yet"
          description="Add your first table and TableFlow will generate a QR code for it."
          action={can('tables:manage') && <Button onClick={() => openEditor(null)}>Add a table</Button>}
        />
      )}

      {tables.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <FloorLegend counts={counts} />
            {arranging && (
              <p className="text-xs font-medium text-accent-strong">
                Drag tables to reposition them, then save.
              </p>
            )}
          </div>

          {view === 'plan' ? (
            <FloorPlan
              tables={tables}
              selectedId={selectedLive?.id}
              editable={arranging}
              onMove={(id, posX, posY) => setPending((current) => ({ ...current, [id]: { posX, posY } }))}
              onSelect={(table) => (arranging ? undefined : setSelected(table))}
            />
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
              {tables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  currency={currency}
                  onOpen={() => setSelected(table)}
                />
              ))}
            </div>
          )}

          {can('tables:manage') && (
            <div className="mt-6">
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                Edit a table
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {tables.map((table) => (
                  <button
                    key={table.id}
                    onClick={() => openEditor(table)}
                    className="tabular rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent/40 hover:text-accent-strong"
                  >
                    {table.number}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <TableDetailPanel table={selectedLive} open={selected !== null} onClose={() => setSelected(null)} />

      <SidePanel
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        width="sm"
        title={editing ? `Table ${editing.number}` : 'New table'}
        description={editing ? 'Update how this table appears on the floor.' : 'A QR code is generated automatically.'}
        footer={
          <div className="flex items-center justify-between gap-3">
            {editing && (
              <Button variant="ghost" size="sm" loading={removeTable.isPending} onClick={() => removeTable.mutate()}>
                Remove
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button loading={saveTable.isPending} onClick={() => saveTable.mutate()}>
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Number" htmlFor="t-number" required>
            <Input
              id="t-number"
              value={draft.number}
              onChange={(event) => setDraft({ ...draft, number: event.target.value })}
              placeholder="12"
              className="tabular"
            />
          </Field>
          <Field label="Label" htmlFor="t-label" hint="optional">
            <Input
              id="t-label"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              placeholder="Corner booth"
            />
          </Field>
          <Field label="Seats" htmlFor="t-seats">
            <Input
              id="t-seats"
              type="number"
              min={1}
              max={40}
              value={draft.seats}
              onChange={(event) => setDraft({ ...draft, seats: event.target.value })}
              className="tabular"
            />
          </Field>
          <Field label="Zone" htmlFor="t-zone" hint="optional">
            <Input
              id="t-zone"
              value={draft.zone}
              onChange={(event) => setDraft({ ...draft, zone: event.target.value })}
              placeholder="Terrace"
            />
          </Field>
          <Field label="Shape" htmlFor="t-shape">
            <Select
              id="t-shape"
              value={draft.shape}
              onChange={(event) => setDraft({ ...draft, shape: event.target.value as Draft['shape'] })}
            >
              <option value="ROUND">Round</option>
              <option value="SQUARE">Square</option>
              <option value="RECT">Rectangular</option>
            </Select>
          </Field>

          {editing && (
            <Switch
              checked={draft.outOfService}
              onChange={(value) => setDraft({ ...draft, outOfService: value })}
              label="Out of service"
              description="Guests scanning this table's code are told it is unavailable."
            />
          )}
        </div>
      </SidePanel>
    </Page>
  );
}
