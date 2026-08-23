import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, ExternalLink, QrCode } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Badge, Button, Select } from '@/components/ui/primitives';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';

interface DevTable {
  id: string;
  number: string;
  label: string | null;
  seats: number;
  zone: string | null;
  status: string;
  qrUrl: string | null;
  token: string | null;
  activeSession: { id: string; code: string; status: string } | null;
}

interface DevBranch {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  serviceRadiusMeters: number;
  requireLocation: boolean;
  tables: DevTable[];
}

interface DevPayload {
  webUrl: string;
  restaurants: Array<{ id: string; name: string; branches: DevBranch[] }>;
}

/**
 * The QR Test Center.
 *
 * Printing codes is not practical while developing, so this page lists every
 * seeded table with a working guest link. The endpoint behind it is disabled
 * whenever the API is not in demo mode.
 */
export default function QrTestCenter() {
  const toast = useToast();
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['dev', 'qr-test-center'],
    queryFn: () => api.get<DevPayload>('/dev/qr-test-center', 'none'),
    retry: false,
  });

  const restaurants = query.data?.restaurants ?? [];
  const restaurant = restaurants.find((r) => r.id === restaurantId) ?? restaurants[0];
  const branch = useMemo(
    () => restaurant?.branches.find((b) => b.id === branchId) ?? restaurant?.branches[0],
    [restaurant, branchId],
  );

  const disabled =
    query.error instanceof ApiError && query.error.code === 'DEMO_DISABLED';

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy', 'Your browser blocked clipboard access.');
    }
  };

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link
          to="/"
          className="-ml-2 mb-6 inline-flex items-center gap-1.5 rounded p-2 text-sm font-medium text-ink-soft hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Home
        </Link>

        <div className="mb-8 flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
            <QrCode className="size-5" strokeWidth={1.8} aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">QR Test Center</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
              Open the guest experience for any seeded table without printing a code. Each link carries the
              same secure token the printed QR would.
            </p>
          </div>
        </div>

        {query.isLoading && <LoadingRows rows={6} />}

        {disabled && (
          <EmptyState
            icon={<QrCode className="size-5" />}
            title="Developer tools are disabled"
            description="The QR Test Center only exists when the API runs with DEMO_MODE enabled, and it is force-disabled in production."
          />
        )}

        {query.isError && !disabled && (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}

        {restaurant && branch && (
          <>
            <div className="mb-5 flex flex-wrap gap-3">
              <div className="min-w-48">
                <label htmlFor="restaurant" className="mb-1.5 block text-[0.8125rem] font-medium text-ink-soft">
                  Restaurant
                </label>
                <Select
                  id="restaurant"
                  value={restaurant.id}
                  onChange={(event) => {
                    setRestaurantId(event.target.value);
                    setBranchId(null);
                  }}
                >
                  {restaurants.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="min-w-56">
                <label htmlFor="branch" className="mb-1.5 block text-[0.8125rem] font-medium text-ink-soft">
                  Branch
                </label>
                <Select id="branch" value={branch.id} onChange={(event) => setBranchId(event.target.value)}>
                  {restaurant.branches.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="mb-5 rounded-lg border border-line bg-surface p-4 text-xs text-ink-muted shadow-subtle">
              <p>
                <span className="font-medium text-ink-soft">Location gate:</span>{' '}
                {branch.requireLocation
                  ? `on — guests must be within ${branch.serviceRadiusMeters} m of ${branch.latitude.toFixed(4)}, ${branch.longitude.toFixed(4)}`
                  : 'off for this branch'}
                . In demo mode the guest screen offers a “simulate being at the restaurant” shortcut.
              </p>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {branch.tables.map((table) => (
                <div
                  key={table.id}
                  className={cn(
                    'rounded-lg border bg-surface p-4 shadow-subtle',
                    table.number === '03' ? 'border-accent/40 ring-1 ring-accent/20' : 'border-line',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display text-lg font-semibold leading-none text-ink">
                        Table {table.number}
                      </p>
                      <p className="mt-1 truncate text-2xs text-ink-muted">
                        {table.zone ?? '—'} · {table.seats} seats
                      </p>
                    </div>
                    {table.number === '03' && (
                      <Badge tone="accent" size="sm">
                        Demo
                      </Badge>
                    )}
                  </div>

                  {table.activeSession && (
                    <p className="tabular mt-2 text-2xs text-ink-muted">
                      Live session {table.activeSession.code}
                    </p>
                  )}

                  {table.qrUrl ? (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => window.open(table.qrUrl!, '_blank', 'noopener')}
                        trailingIcon={<ExternalLink className="size-3.5" />}
                      >
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void copy(table.qrUrl!)}
                        aria-label={`Copy link for table ${table.number}`}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 text-2xs text-danger">No active QR token</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
