import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, ExternalLink, Printer, QrCode, RefreshCw, ShieldOff } from 'lucide-react';
import { ApiError, api, authorizedImageUrl, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Badge, Button, Spinner } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { ConfirmDialog, Dialog, useToast } from '@/components/ui/overlays';
import { Page, PageHeading } from '@/console/PageShell';
import type { FloorTable } from '@/staff/components/floor';

interface TablesPayload {
  branchId: string;
  tables: FloorTable[];
}

export default function QrPage() {
  const { branchId, can, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [preview, setPreview] = useState<FloorTable | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<FloorTable | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['tables', branchId],
    queryFn: () => api.get<TablesPayload>(`/tables?branchId=${branchId}`),
    enabled: Boolean(branchId),
  });

  // The QR image sits behind auth, so it is fetched and turned into a blob URL.
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    if (preview) {
      setPreviewUrl(null);
      void authorizedImageUrl(`/tables/${preview.id}/qr?format=png&size=640`)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          revoked = url;
          setPreviewUrl(url);
        })
        .catch(() => toast.error('Could not load the QR image'));
    }

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [preview, toast]);

  const regenerate = useMutation({
    mutationFn: (tableId: string) => api.post(`/tables/${tableId}/regenerate-qr`, {}),
    onSuccess: () => {
      setRegenerating(null);
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ['tables', branchId] });
      toast.success('New QR code issued', 'The previous printed code no longer works.');
    },
    onError: (error) =>
      toast.error('Could not regenerate', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const deactivate = useMutation({
    mutationFn: (tableId: string) => api.post(`/tables/${tableId}/deactivate-qr`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tables', branchId] });
      toast.success('QR code deactivated');
    },
    onError: (error) =>
      toast.error('Could not deactivate', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const tables = query.data?.tables ?? [];

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy', 'Your browser blocked clipboard access.');
    }
  };

  const downloadSheet = async (ids?: string[]) => {
    try {
      await downloadFile(
        `/tables/qr/sheet.pdf?branchId=${branchId}${ids && ids.length > 0 ? `&ids=${ids.join(',')}` : ''}`,
        'tableflow-qr-sheet.pdf',
      );
      toast.success('Sheet downloaded', 'Print, cut and place on the tables.');
    } catch {
      toast.error('Could not generate the sheet');
    }
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Page>
      <PageHeading
        title="QR codes"
        description="Each table carries a unique, high-entropy code. Regenerating one invalidates the printed version immediately."
        actions={
          can('tables:qr_manage') && (
            <>
              {selected.size > 0 && (
                <Button
                  variant="secondary"
                  leadingIcon={<Printer className="size-4" />}
                  onClick={() => void downloadSheet([...selected])}
                >
                  Sheet for {selected.size} selected
                </Button>
              )}
              <Button leadingIcon={<Printer className="size-4" />} onClick={() => void downloadSheet()}>
                Print all QR codes
              </Button>
            </>
          )
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
          icon={<QrCode className="size-5" />}
          title="No tables to print"
          description="Add tables first and a QR code is created for each one."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {tables.map((table) => (
          <article
            key={table.id}
            className={cn(
              'rounded-lg border bg-surface p-4 shadow-subtle transition-colors',
              selected.has(table.id) ? 'border-accent ring-1 ring-accent/20' : 'border-line',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(table.id)}
                  onChange={() => toggleSelected(table.id)}
                  className="mt-1 size-4 rounded border-line-strong text-accent focus:ring-accent/40"
                  aria-label={`Select table ${table.number}`}
                />
                <span className="min-w-0">
                  <span className="block font-display text-lg font-semibold leading-none text-ink">
                    Table {table.number}
                  </span>
                  <span className="mt-1 block truncate text-2xs text-ink-muted">
                    {table.zone ?? 'No zone'} · {table.seats} seats
                  </span>
                </span>
              </label>
              {table.qr ? (
                <Badge tone="success" size="sm" dot>
                  Active
                </Badge>
              ) : (
                <Badge tone="danger" size="sm" dot>
                  No code
                </Badge>
              )}
            </div>

            {table.qr && (
              <>
                <p className="tabular mt-3 truncate rounded bg-surface-sunken px-2.5 py-1.5 text-2xs text-ink-muted">
                  {table.qr.url}
                </p>
                <p className="mt-1.5 text-2xs text-ink-muted">
                  {table.qr.scanCount} scan{table.qr.scanCount === 1 ? '' : 's'}
                </p>
              </>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setPreview(table)}>
                Preview
              </Button>
              {table.qr && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => void copyLink(table.qr!.url)} aria-label="Copy link">
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(table.qr!.url, '_blank', 'noopener')}
                    aria-label="Open guest view"
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </>
              )}
              {can('tables:qr_manage') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setRegenerating(table)}
                  aria-label="Regenerate QR"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>

      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? `Table ${preview.number}` : ''}
        description={user?.restaurant.name}
        size="sm"
        footer={
          preview && (
            <div className="flex flex-wrap justify-end gap-2">
              {can('tables:qr_manage') && (
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<ShieldOff className="size-3.5" />}
                  loading={deactivate.isPending}
                  onClick={() => deactivate.mutate(preview.id)}
                >
                  Deactivate
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Download className="size-3.5" />}
                onClick={() =>
                  void downloadFile(
                    `/tables/${preview.id}/qr?format=png&size=1024&download=1`,
                    `table-${preview.number}-qr.png`,
                  )
                }
              >
                PNG
              </Button>
              <Button
                size="sm"
                leadingIcon={<Printer className="size-3.5" />}
                onClick={() => void downloadSheet([preview.id])}
              >
                Printable card
              </Button>
            </div>
          )
        }
      >
        <div className="flex flex-col items-center">
          <div className="flex size-56 items-center justify-center rounded-lg border border-line bg-white p-3">
            {previewUrl ? (
              <img src={previewUrl} alt={`QR code for table ${preview?.number}`} className="size-full object-contain" />
            ) : (
              <Spinner />
            )}
          </div>
          <p className="mt-4 text-center text-sm text-ink-muted">Scan to open the menu for this table.</p>
          {preview?.qr && (
            <p className="tabular mt-2 break-all text-center text-2xs text-ink-muted">{preview.qr.url}</p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={regenerating !== null}
        onClose={() => setRegenerating(null)}
        onConfirm={() => regenerating && regenerate.mutate(regenerating.id)}
        loading={regenerate.isPending}
        tone="danger"
        title={`Regenerate the code for table ${regenerating?.number ?? ''}?`}
        message="A brand new token is issued. Any code already printed and sitting on that table stops working the moment you confirm — you will need to reprint it."
        confirmLabel="Regenerate"
      />
    </Page>
  );
}
