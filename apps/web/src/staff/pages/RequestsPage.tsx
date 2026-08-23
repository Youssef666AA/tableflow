import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, BellOff, Check, Play } from 'lucide-react';
import { SERVICE_REQUEST_LABEL } from '@tableflow/shared';
import { ApiError, api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatSeconds, formatTime, relativeTime } from '@/lib/format';
import { useNow, useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Button, SegmentedControl, Spinner } from '@/components/ui/primitives';
import { EmptyState, ErrorState, RequestStatusBadge } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';
import { Page, PageHeading } from '@/console/PageShell';

interface RequestRow {
  id: string;
  tableId: string;
  tableNumber: string;
  zone: string | null;
  sessionCode: string | null;
  customerName: string | null;
  type: string;
  label: string;
  status: 'REQUESTED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  note: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  responseSeconds: number | null;
  resolutionSeconds: number | null;
  acknowledgedBy: string | null;
  completedBy: string | null;
}

type Scope = 'open' | 'all';

export default function RequestsPage() {
  const { branchId } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());
  const now = useNow(15_000);

  const [scope, setScope] = useState<Scope>('open');

  const query = useQuery({
    queryKey: ['service-requests', branchId, scope],
    queryFn: () => api.get<{ requests: RequestRow[] }>(`/service-requests?branchId=${branchId}&status=${scope}`),
    enabled: Boolean(branchId),
    refetchInterval: 30_000,
  });

  useRealtimeInvalidation(
    socket,
    ['service_request:created', 'service_request:updated'],
    [['service-requests', branchId, scope]],
  );

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'acknowledge' | 'start' | 'complete' | 'cancel' }) =>
      api.post(`/service-requests/${id}/${action}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
    },
    onError: (error) =>
      toast.error('That did not work', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const requests = query.data?.requests ?? [];
  const openCount = requests.filter((request) => !['COMPLETED', 'CANCELLED'].includes(request.status)).length;

  return (
    <Page width="narrow">
      <PageHeading
        title="Service requests"
        description="Anything a guest has asked for, oldest first."
        actions={
          <SegmentedControl
            value={scope}
            onChange={setScope}
            size="sm"
            options={[
              { value: 'open', label: 'Open', count: scope === 'open' ? requests.length : openCount },
              { value: 'all', label: 'All' },
            ]}
          />
        }
      />

      {query.isLoading && (
        <div className="flex h-52 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      )}

      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && requests.length === 0 && (
        <EmptyState
          icon={<BellOff className="size-5" />}
          title={scope === 'open' ? 'No open requests' : 'No requests yet'}
          description={
            scope === 'open'
              ? 'Everything guests have asked for has been dealt with.'
              : 'When a guest taps for water, cutlery or the bill, it lands here instantly.'
          }
          className="py-16"
        />
      )}

      <div className="space-y-2.5">
        <AnimatePresence initial={false}>
          {requests.map((request) => {
            const waitingSeconds = Math.floor((now - new Date(request.createdAt).getTime()) / 1000);
            const stale = request.status === 'REQUESTED' && waitingSeconds > 180;
            const done = ['COMPLETED', 'CANCELLED'].includes(request.status);

            return (
              <motion.article
                key={request.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  'rounded-lg border bg-surface p-4 shadow-subtle',
                  stale ? 'border-danger/40' : 'border-line',
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-md',
                        done ? 'bg-surface-sunken text-ink-muted' : 'bg-warning-soft text-warning',
                      )}
                    >
                      <Bell className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        Table {request.tableNumber} · {SERVICE_REQUEST_LABEL[request.type] ?? request.label}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {request.zone ? `${request.zone} · ` : ''}
                        {formatTime(request.createdAt)} · {relativeTime(request.createdAt, now)}
                        {request.customerName ? ` · ${request.customerName}` : ''}
                      </p>
                      {request.note && (
                        <p className="mt-1.5 rounded bg-surface-sunken px-2.5 py-1.5 text-xs leading-relaxed text-ink-soft">
                          {request.note}
                        </p>
                      )}
                      {done && (
                        <p className="mt-1.5 text-2xs text-ink-muted">
                          {request.acknowledgedBy && `Acknowledged by ${request.acknowledgedBy}`}
                          {request.responseSeconds != null && ` in ${formatSeconds(request.responseSeconds)}`}
                          {request.completedBy && ` · completed by ${request.completedBy}`}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <RequestStatusBadge status={request.status} size="sm" />
                    {!done && (
                      <span
                        className={cn(
                          'tabular text-2xs font-medium',
                          stale ? 'text-danger' : 'text-ink-muted',
                        )}
                      >
                        waiting {formatSeconds(waitingSeconds)}
                      </span>
                    )}
                  </div>
                </div>

                {!done && (
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                    {request.status === 'REQUESTED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={act.isPending && act.variables?.id === request.id && act.variables.action === 'acknowledge'}
                        onClick={() => act.mutate({ id: request.id, action: 'acknowledge' })}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {request.status !== 'IN_PROGRESS' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        leadingIcon={<Play className="size-3.5" />}
                        onClick={() => act.mutate({ id: request.id, action: 'start' })}
                      >
                        On it
                      </Button>
                    )}
                    <Button
                      size="sm"
                      leadingIcon={<Check className="size-3.5" />}
                      loading={act.isPending && act.variables?.id === request.id && act.variables.action === 'complete'}
                      onClick={() => act.mutate({ id: request.id, action: 'complete' })}
                    >
                      Complete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act.mutate({ id: request.id, action: 'cancel' })}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </Page>
  );
}
