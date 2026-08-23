import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Star } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import { formatDateTime, money } from '@/lib/format';
import { Button } from '@/components/ui/primitives';
import { ErrorState, LoadingRows } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';
import { useSession, useSessionAuth } from '../session';

interface ReceiptSnapshot {
  number: string;
  issuedAt: string;
  restaurant: { name: string; legalName: string | null; currency: string; taxRateBps: number; serviceChargeRateBps: number };
  branch: { name: string; address: string | null; phone: string | null };
  session: { code: string; tableNumber: string; startedAt: string; guestCount: number; customerName: string | null };
  orders: Array<{
    number: number;
    placedAt: string;
    items: Array<{
      name: string;
      variantName: string | null;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      modifiers: Array<{ name: string; priceDelta: number }>;
      notes: string | null;
    }>;
    promotions: Array<{ name: string; amount: number }>;
    total: number;
  }>;
  totals: { subtotal: number; discountTotal: number; taxTotal: number; serviceChargeTotal: number; total: number; tip: number };
  payments: Array<{ method: string; amount: number; tip: number; reference: string | null; processedAt: string | null; simulated: boolean }>;
}

export default function ReceiptPage() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const auth = useSessionAuth();
  const { data } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const query = useQuery({
    queryKey: ['customer', 'receipt', receiptId],
    queryFn: () =>
      api.get<{ receipt: { id: string; number: string; issuedAt: string; snapshot: ReceiptSnapshot } }>(
        `/customer/receipts/${receiptId}`,
        auth,
      ),
    enabled: Boolean(receiptId),
  });

  const receipt = query.data?.receipt;
  const snapshot = receipt?.snapshot;
  const currency = snapshot?.restaurant.currency ?? 'TND';

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/customer/receipts/${receiptId}/pdf`, `receipt-${receipt?.number}.pdf`, auth);
    } catch {
      toast.error('Download failed', 'Please try again in a moment.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-phone px-4 pb-32">
      <div className="flex items-center justify-between gap-3 pt-4">
        <button
          onClick={() => navigate('../bill')}
          className="-ml-2 inline-flex items-center gap-1.5 rounded p-2 text-sm font-medium text-ink-soft hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Bill
        </button>
        {receipt && <span className="tabular text-sm text-ink-muted">{receipt.number}</span>}
      </div>

      {query.isLoading && <LoadingRows rows={5} className="mt-8" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} className="py-16" />}

      {snapshot && (
        <>
          <article className="mt-3 overflow-hidden rounded-lg border border-line bg-surface shadow-subtle">
            <header className="border-b border-dashed border-line px-5 py-5 text-center">
              <h1 className="font-display text-xl font-semibold text-ink">{snapshot.restaurant.name}</h1>
              <p className="mt-1 text-xs text-ink-muted">{snapshot.branch.name}</p>
              {snapshot.branch.address && <p className="text-xs text-ink-muted">{snapshot.branch.address}</p>}
              <p className="mt-3 text-2xs uppercase tracking-wider text-ink-muted">Receipt {snapshot.number}</p>
              <p className="text-xs text-ink-muted">{formatDateTime(snapshot.issuedAt)}</p>
            </header>

            <div className="grid grid-cols-2 gap-3 border-b border-dashed border-line px-5 py-4 text-xs">
              <div>
                <p className="text-ink-muted">Table</p>
                <p className="font-medium text-ink">{snapshot.session.tableNumber}</p>
              </div>
              <div className="text-right">
                <p className="text-ink-muted">Session</p>
                <p className="tabular font-medium text-ink">{snapshot.session.code}</p>
              </div>
            </div>

            <div className="px-5 py-4">
              {snapshot.orders.map((order) => (
                <div key={order.number} className="mb-4 last:mb-0">
                  <p className="tabular mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                    Order #{order.number}
                  </p>
                  <ul className="space-y-2">
                    {order.items.map((item, index) => (
                      <li key={index}>
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0 text-ink">
                            <span className="tabular font-medium text-ink-muted">{item.quantity}×</span>{' '}
                            {item.name}
                            {item.variantName && <span className="text-ink-muted"> · {item.variantName}</span>}
                          </span>
                          <span className="tabular shrink-0 text-ink">{money(item.lineTotal, currency)}</span>
                        </div>
                        {item.modifiers.length > 0 && (
                          <p className="mt-0.5 pl-5 text-2xs text-ink-muted">
                            {item.modifiers.map((modifier) => modifier.name).join(' · ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                  {order.promotions.map((promotion, index) => (
                    <div key={index} className="mt-1.5 flex justify-between text-xs text-accent-strong">
                      <span>{promotion.name}</span>
                      <span className="tabular">−{money(promotion.amount, currency)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-line px-5 py-4">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Subtotal</dt>
                  <dd className="tabular text-ink">{money(snapshot.totals.subtotal, currency)}</dd>
                </div>
                {snapshot.totals.discountTotal > 0 && (
                  <div className="flex justify-between text-accent-strong">
                    <dt>Discounts</dt>
                    <dd className="tabular">−{money(snapshot.totals.discountTotal, currency)}</dd>
                  </div>
                )}
                {snapshot.totals.taxTotal > 0 && (
                  <div className="flex justify-between text-xs">
                    <dt className="text-ink-muted">
                      VAT ({(snapshot.restaurant.taxRateBps / 100).toFixed(0)}%, included)
                    </dt>
                    <dd className="tabular text-ink-muted">{money(snapshot.totals.taxTotal, currency)}</dd>
                  </div>
                )}
                {snapshot.totals.serviceChargeTotal > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Service charge</dt>
                    <dd className="tabular text-ink">{money(snapshot.totals.serviceChargeTotal, currency)}</dd>
                  </div>
                )}
                {snapshot.totals.tip > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Tip</dt>
                    <dd className="tabular text-ink">{money(snapshot.totals.tip, currency)}</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                  <dt className="font-semibold text-ink">Total paid</dt>
                  <dd className="tabular font-display text-xl font-semibold text-ink">
                    {money(snapshot.totals.total + snapshot.totals.tip, currency)}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 space-y-1 border-t border-dashed border-line pt-3">
                {snapshot.payments.map((payment, index) => (
                  <p key={index} className="text-2xs text-ink-muted">
                    {money(payment.amount, currency)} · {payment.method.replace(/_/g, ' ').toLowerCase()}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                    {payment.simulated && (
                      <span className="ml-1 text-warning">(simulated — no real funds were transferred)</span>
                    )}
                  </p>
                ))}
              </div>
            </div>

            <footer className="border-t border-dashed border-line px-5 py-4 text-center">
              <p className="text-xs text-ink-muted">Thank you for dining with us.</p>
              <p className="mt-0.5 text-2xs text-ink-muted">Generated by TableFlow</p>
            </footer>
          </article>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button
              variant="secondary"
              size="lg"
              loading={downloading}
              onClick={() => void download()}
              leadingIcon={<Download className="size-4" />}
            >
              Download PDF
            </Button>
            <Button size="lg" onClick={() => navigate('../review')} leadingIcon={<Star className="size-4" />}>
              Leave a review
            </Button>
          </div>

          <p className="mt-4 text-center text-2xs text-ink-muted">
            Table {data.table.number} · {data.restaurant.name}
          </p>
        </>
      )}
    </div>
  );
}
