import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, LayoutGrid, Map, Utensils } from 'lucide-react';
import type { TableStatus } from '@tableflow/shared';
import { SERVICE_REQUEST_LABEL } from '@tableflow/shared';
import { ApiError, api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, relativeTime } from '@/lib/format';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Button, SegmentedControl, Spinner } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';
import { Page, PageHeading, SectionHeading } from '@/console/PageShell';
import { FloorLegend, FloorPlan, TableCard, type FloorTable } from '../components/floor';
import { TableDetailPanel } from '../components/TableDetailPanel';

interface TablesPayload {
  branchId: string;
  tables: FloorTable[];
}

interface ServiceRequestRow {
  id: string;
  tableId: string;
  tableNumber: string;
  type: string;
  label: string;
  status: 'REQUESTED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  note: string | null;
  createdAt: string;
}

/**
 * The waiter's home screen: what needs a person right now, then the room.
 */
export default function WaiterPage() {
  const { branchId, currency } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());

  const [view, setView] = useState<'plan' | 'grid'>('plan');
  const [selected, setSelected] = useState<FloorTable | null>(null);

  const tablesQuery = useQuery({
    queryKey: ['tables', branchId],
    queryFn: () => api.get<TablesPayload>(`/tables?branchId=${branchId}`),
    enabled: Boolean(branchId),
    refetchInterval: 45_000,
  });

  const requestsQuery = useQuery({
    queryKey: ['service-requests', branchId],
    queryFn: () => api.get<{ requests: ServiceRequestRow[] }>(`/service-requests?branchId=${branchId}`),
    enabled: Boolean(branchId),
    refetchInterval: 45_000,
  });

  useRealtimeInvalidation(
    socket,
    ['table:updated', 'session:updated', 'order:created', 'order:updated', 'service_request:created', 'service_request:updated'],
    [['tables', branchId], ['service-requests', branchId]],
  );

  const handleRequest = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'acknowledge' | 'complete' }) =>
      api.post(`/service-requests/${id}/${action}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['service-requests', branchId] }),
    onError: (error) =>
      toast.error('That did not work', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const tables = useMemo(() => tablesQuery.data?.tables ?? [], [tablesQuery.data]);
  const requests = requestsQuery.data?.requests ?? [];

  const counts = useMemo(() => {
    const result: Partial<Record<TableStatus, number>> = {};
    tables.forEach((table) => {
      result[table.status] = (result[table.status] ?? 0) + 1;
    });
    return result;
  }, [tables]);

  const readyTables = tables.filter((table) => table.status === 'FOOD_READY');

  // Keep the open panel in step with live updates.
  const selectedLive = selected ? (tables.find((table) => table.id === selected.id) ?? selected) : null;

  return (
    <Page>
      <PageHeading
        title="Floor"
        description="Tables, food that is ready and anything a guest has asked for."
        actions={
          <SegmentedControl
            value={view}
            onChange={setView}
            size="sm"
            options={[
              { value: 'plan', label: <span className="inline-flex items-center gap-1.5"><Map className="size-3.5" />Plan</span> },
              { value: 'grid', label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" />Grid</span> },
            ]}
          />
        }
      />

      {(readyTables.length > 0 || requests.length > 0) && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <section>
            <SectionHeading title="Ready to serve" description="Plated and waiting on the pass" />
            {readyTables.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-ink-muted">
                Nothing waiting.
              </p>
            ) : (
              <div className="space-y-2">
                {readyTables.map((table) => (
                  <div
                    key={table.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-display text-base font-semibold leading-none text-accent-strong">
                        Table {table.number}
                      </p>
                      <p className="mt-1 text-xs text-accent-strong/80">
                        {table.session?.openOrderCount ?? 0} open ·{' '}
                        {money(table.session?.runningTotal ?? 0, currency)}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => setSelected(table)}>
                      Open table
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeading title="Service requests" description="Oldest first" />
            {requests.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-ink-muted">
                No open requests.
              </p>
            ) : (
              <div className="space-y-2">
                {requests.slice(0, 6).map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-subtle"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Bell className="size-3.5 text-warning" aria-hidden />
                        Table {request.tableNumber} · {SERVICE_REQUEST_LABEL[request.type] ?? request.label}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {relativeTime(request.createdAt)}
                        {request.note ? ` · ${request.note}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {request.status === 'REQUESTED' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleRequest.mutate({ id: request.id, action: 'acknowledge' })}
                        >
                          Ack
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleRequest.mutate({ id: request.id, action: 'complete' })}
                        leadingIcon={<Check className="size-3.5" />}
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tablesQuery.isLoading && (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      )}

      {tablesQuery.isError && (
        <ErrorState error={tablesQuery.error} onRetry={() => void tablesQuery.refetch()} />
      )}

      {tables.length === 0 && tablesQuery.isSuccess && (
        <EmptyState
          icon={<Utensils className="size-5" />}
          title="No tables yet"
          description="A manager can add tables and print QR codes from the management console."
        />
      )}

      {tables.length > 0 && (
        <>
          <div className="mb-3">
            <FloorLegend counts={counts} />
          </div>

          {view === 'plan' ? (
            <FloorPlan tables={tables} selectedId={selectedLive?.id} onSelect={setSelected} />
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
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
        </>
      )}

      <TableDetailPanel
        table={selectedLive}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </Page>
  );
}
