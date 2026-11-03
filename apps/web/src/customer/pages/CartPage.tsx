import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ShoppingBag, Trash2 } from 'lucide-react';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { money } from '@/lib/format';
import { useOnlineStatus } from '@/lib/hooks';
import { Button, IconButton, Input, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, useToast } from '@/components/ui/overlays';
import { EmptyState } from '@/components/ui/feedback';
import { FoodAvatar } from '@/components/ui/food-image';
import { QuantityStepper } from '../components/menu';
import { useCart } from '../cart';
import { useSession, useSessionAuth } from '../session';
import type { CustomerOrder } from '../types';

export default function CartPage() {
  const { data, currency, refresh } = useSession();
  const auth = useSessionAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();

  const [customerName, setCustomerName] = useState(data.session.customerName ?? '');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [duplicate, setDuplicate] = useState<{ orderNumber?: number } | null>(null);
  const [recovering, setRecovering] = useState(false);

  /**
   * One key per checkout attempt. Reusing it across retries is exactly what
   * makes a double-tap or a flaky connection safe.
   */
  const idempotencyKey = useRef(newIdempotencyKey());
  const cartIsEmpty = cart.itemCount === 0;
  useEffect(() => {
    // A fresh checkout attempt deserves a fresh key; a retry of the same cart must not.
    idempotencyKey.current = newIdempotencyKey();
  }, [cartIsEmpty]);

  const quote = cart.quote;
  const canOrder = data.openState.open && data.verified && cart.itemCount > 0;

  const place = async (confirmDuplicate = false) => {
    if (!online) {
      toast.error('You appear to be offline', 'We will not send the order until you are back online.');
      return;
    }

    setSubmitting(true);
    setDuplicate(null);

    try {
      const response = await api.post<{ order: CustomerOrder; reused: boolean }>(
        '/customer/orders',
        {
          lines: cart.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            modifierOptionIds: line.modifierOptionIds,
            notes: line.notes,
          })),
          notes: notes.trim() || null,
          customerName: customerName.trim() || null,
          idempotencyKey: idempotencyKey.current,
          confirmDuplicate,
        },
        auth,
      );

      cart.clear();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['customer', 'orders'] })]);
      toast.success(
        response.reused ? 'That order was already placed' : `Order ${response.order.reference} sent to the kitchen`,
        'You can follow it live.',
      );
      navigate(`../order/${response.order.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE_ORDER') {
        const details = error.details as { existingOrderNumber?: number } | undefined;
        setDuplicate({ orderNumber: details?.existingOrderNumber });
      } else if (error instanceof ApiError && error.isOffline) {
        // We genuinely do not know whether the server saw it. Ask, don't assume.
        setRecovering(true);
        await checkWhetherItLanded();
      } else if (error instanceof ApiError) {
        toast.error('We could not place your order', error.message);
      } else {
        toast.error('We could not place your order', 'Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** After a network failure, ask the server whether the order exists before retrying. */
  const checkWhetherItLanded = async () => {
    try {
      const response = await api.get<{ orders: CustomerOrder[] }>('/customer/orders', auth);
      const match = response.orders.find(
        (order) => Date.now() - new Date(order.createdAt).getTime() < 120_000,
      );
      if (match) {
        cart.clear();
        toast.success(`Order ${match.reference} did go through`, 'Your connection dropped after it was sent.');
        navigate(`../order/${match.id}`, { replace: true });
        return;
      }
      toast.warning('Your order was not sent', 'Nothing was charged. Please try again.');
    } catch {
      toast.error('Still offline', 'We could not check your order status. Please try again shortly.');
    } finally {
      setRecovering(false);
    }
  };

  if (cart.itemCount === 0) {
    return (
      <div className="mx-auto max-w-phone px-4 pb-32">
        <CartHeader onBack={() => navigate('../menu')} />
        <EmptyState
          icon={<ShoppingBag className="size-5" />}
          title="Your cart is empty"
          description="Add something appetizing from the menu and it will show up here."
          action={<Button onClick={() => navigate('../menu')}>Browse the menu</Button>}
          className="py-16"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-phone px-4 pb-48">
      <CartHeader
        onBack={() => navigate('../menu')}
        action={
          <IconButton label="Clear cart" size="sm" onClick={() => setConfirmClear(true)}>
            <Trash2 className="size-4" />
          </IconButton>
        }
      />

      <div className="pb-3 pt-1">
        <p className="text-xs font-medium text-ink-muted">
          Table {data.table.number} · {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} ready to fire
        </p>
      </div>

      {/* Cart items list */}
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {cart.lines.map((line) => (
            <motion.li
              key={line.key}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden rounded-2xl border border-line/75 bg-surface p-4 shadow-subtle"
            >
              <div className="flex gap-3.5">
                <FoodAvatar name={line.productName} src={line.imageUrl} className="size-14 rounded-xl" />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{line.productName}</p>
                      {line.variantName && (
                        <p className="mt-0.5 text-xs font-medium text-accent-strong">{line.variantName}</p>
                      )}
                    </div>
                    <p className="tabular shrink-0 text-sm font-bold text-ink">
                      {money(line.estimatedUnitPrice * line.quantity, currency)}
                    </p>
                  </div>

                  {line.modifierLabels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {line.modifierLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-ink-soft"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  {line.notes && (
                    <p className="mt-2 text-xs italic leading-relaxed text-ink-muted">“{line.notes}”</p>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-3 pt-1">
                    <QuantityStepper
                      size="sm"
                      min={0}
                      value={line.quantity}
                      onChange={(quantity) => cart.setQuantity(line.key, quantity)}
                    />
                    <button
                      type="button"
                      onClick={() => cart.remove(line.key)}
                      className="text-xs font-semibold text-ink-muted transition-colors hover:text-danger active:scale-95"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {/* Guest info & kitchen note */}
      <section className="mt-6 space-y-3.5">
        <div className="rounded-2xl border border-line/75 bg-surface p-4 shadow-subtle">
          <label htmlFor="cart-name" className="mb-1.5 block text-xs font-semibold text-ink-soft">
            Your name <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <Input
            id="cart-name"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="So our waitstaff knows who to serve"
            maxLength={60}
            className="rounded-xl border-line/80 focus:border-accent"
          />
        </div>

        <div className="rounded-2xl border border-line/75 bg-surface p-4 shadow-subtle">
          <label htmlFor="cart-notes" className="mb-1.5 block text-xs font-semibold text-ink-soft">
            Note for the kitchen <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <Textarea
            id="cart-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Allergies, timing preferences, dish adjustments…"
            maxLength={500}
            rows={2}
            className="rounded-xl border-line/80 focus:border-accent"
          />
        </div>
      </section>

      {/* Perforated receipt breakdown */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-line/75 bg-surface p-5 shadow-subtle">
        <div className="flex items-center justify-between pb-3 border-b border-line/60">
          <h3 className="font-display text-sm font-bold text-ink">Order summary</h3>
          <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
            Table {data.table.number}
          </span>
        </div>

        {quote ? (
          <dl className="mt-3.5 space-y-2.5 text-sm">
            <Row label="Subtotal" value={money(quote.subtotal, currency)} />
            {quote.appliedPromotions.map((promotion) => (
              <Row
                key={promotion.promotionId}
                label={promotion.name}
                value={`−${money(promotion.amount, currency)}`}
                tone="accent"
              />
            ))}
            {quote.serviceChargeTotal > 0 && (
              <Row label="Service charge" value={money(quote.serviceChargeTotal, currency)} />
            )}
            {quote.taxTotal > 0 && (
              <Row label="VAT (included)" value={money(quote.taxTotal, currency)} muted />
            )}

            {/* Perforated divider line */}
            <div className="my-3 border-t border-dashed border-line-strong" />

            <div className="flex items-baseline justify-between pt-1">
              <dt className="text-base font-bold text-ink">Total</dt>
              <dd className="tabular font-display text-2xl font-bold text-ink">
                {money(quote.total, currency)}
              </dd>
            </div>
          </dl>
        ) : cart.quoteError ? (
          <p className="mt-3 text-sm text-danger">
            {cart.quoteError instanceof ApiError
              ? cart.quoteError.message
              : 'We could not price this cart. Please review your items.'}
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">Working out your total…</p>
        )}
      </section>

      {/* High-converting checkout CTA bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-white/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3.5 backdrop-blur-xl">
        <div className="mx-auto max-w-phone">
          {!data.openState.open && (
            <p className="mb-2 text-center text-xs font-semibold text-danger">
              The restaurant is closed — orders cannot be placed right now.
            </p>
          )}
          {!online && (
            <p className="mb-2 text-center text-xs font-semibold text-warning">
              You appear to be offline. We will not send the order until you reconnect.
            </p>
          )}
          <Button
            size="xl"
            fullWidth
            loading={submitting || recovering}
            disabled={!canOrder || !quote || Boolean(cart.quoteError)}
            onClick={() => void place(false)}
            className="h-14 rounded-2xl bg-accent hover:bg-accent-strong text-white font-bold text-base shadow-lift transition-transform active:scale-[0.98]"
          >
            <span>{recovering ? 'Checking order status…' : 'Place order'}</span>
            {quote && !recovering && (
              <span className="tabular ml-auto font-bold">{money(quote.total, currency)}</span>
            )}
          </Button>
          <button
            type="button"
            onClick={() => navigate('../menu')}
            className="mt-2.5 w-full py-1 text-center text-xs font-semibold text-ink-muted transition-colors hover:text-ink active:scale-95"
          >
            Continue shopping
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          cart.clear();
          setConfirmClear(false);
        }}
        title="Clear your cart?"
        message="Everything you have added will be removed. Your existing orders are not affected."
        confirmLabel="Clear cart"
        tone="danger"
      />

      <ConfirmDialog
        open={duplicate !== null}
        onClose={() => setDuplicate(null)}
        onConfirm={() => void place(true)}
        loading={submitting}
        title="You just ordered this"
        message={
          duplicate?.orderNumber
            ? `Order #${duplicate.orderNumber} with exactly these items went in moments ago. Would you like to order it again?`
            : 'An identical order went in moments ago. Would you like to order it again?'
        }
        confirmLabel="Yes, order again"
        cancelLabel="No, cancel"
      />
    </div>
  );
}

function CartHeader({ onBack, action }: { onBack: () => void; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-4">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft transition-all hover:bg-stone-100 hover:text-ink active:scale-95"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Menu
      </button>
      <h1 className="font-display text-lg font-bold text-ink">Your cart</h1>
      <div className="w-16 text-right">{action}</div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: 'accent';
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={tone === 'accent' ? 'font-medium text-accent-strong' : muted ? 'text-ink-muted' : 'text-ink-muted'}>
        {label}
      </dt>
      <dd
        className={`tabular ${
          tone === 'accent' ? 'font-semibold text-accent-strong' : muted ? 'text-ink-muted' : 'font-medium text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
