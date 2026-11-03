import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Check,
  CupSoda,
  Hand,
  Receipt,
  Soup,
  Sparkles,
  UtensilsCrossed,
} from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Textarea } from '@/components/ui/primitives';
import { RequestStatusBadge } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';
import { PageHeader } from '../components/shell';
import { useSession, useSessionAuth } from '../session';
import type { CustomerServiceRequest } from '../types';

const OPTIONS = [
  { type: 'WATER', label: 'Water', hint: 'Fresh jug or chilled bottle', Icon: CupSoda },
  { type: 'NAPKINS', label: 'Napkins', hint: 'Clean table napkins', Icon: Sparkles },
  { type: 'CUTLERY', label: 'Cutlery', hint: 'Extra forks, knives, spoons', Icon: UtensilsCrossed },
  { type: 'CONDIMENTS', label: 'Condiments', hint: 'Salt, pepper, olive oil, harissa', Icon: Soup },
  { type: 'CALL_WAITER', label: 'Call waiter', hint: 'Staff will come to your table', Icon: Hand },
  { type: 'REQUEST_BILL', label: 'Request bill', hint: 'Prepare the table check', Icon: Receipt },
] as const;

export default function ServicesPage() {
  const { data, sessionToken } = useSession();
  const auth = useSessionAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('customer', sessionToken);

  const [note, setNote] = useState('');

  const query = useQuery({
    queryKey: ['customer', 'requests', data.session.id],
    queryFn: () => api.get<{ requests: CustomerServiceRequest[] }>('/customer/service-requests', auth),
    refetchInterval: 45_000,
  });

  useRealtimeInvalidation(
    socket,
    ['service_request:created', 'service_request:updated'],
    [['customer', 'requests', data.session.id], ['customer', 'session', sessionToken]],
  );

  const mutation = useMutation({
    mutationFn: (type: string) =>
      api.post<{ request: CustomerServiceRequest; reused: boolean }>(
        '/customer/service-requests',
        { type, note: note.trim() || null },
        auth,
      ),
    onSuccess: (result, type) => {
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['customer'] });
      const label = OPTIONS.find((option) => option.type === type)?.label ?? 'Request';
      toast.success(
        result.reused ? `${label} already requested` : 'Your waiter has been notified',
        result.reused ? 'The floor team is on it.' : `${label} · table ${data.table.number}`,
      );
    },
    onError: (error) => {
      toast.error(
        'We could not send that request',
        error instanceof ApiError ? error.message : 'Please try again.',
      );
    },
  });

  const requests = query.data?.requests ?? [];
  const open = requests.filter((request) => !['COMPLETED', 'CANCELLED'].includes(request.status));
  const openTypes = new Set(open.map((request) => request.type));

  return (
    <div className="mx-auto max-w-phone pb-36">
      <PageHeader
        title="Need anything?"
        description="Tap once and a member of staff is immediately notified."
      />

      <div className="px-4">
        <div className="mt-4 grid grid-cols-2 gap-3">
          {OPTIONS.map(({ type, label, hint, Icon }) => {
            const pending = openTypes.has(type);
            const busy = mutation.isPending && mutation.variables === type;

            return (
              <button
                key={type}
                type="button"
                disabled={busy || !data.verified}
                onClick={() => mutation.mutate(type)}
                className={cn(
                  'group flex flex-col items-start gap-2.5 rounded-2xl border p-4 text-left transition-all active:scale-[0.97]',
                  pending
                    ? 'border-accent bg-accent-soft/50 shadow-xs'
                    : 'border-line/75 bg-surface shadow-subtle hover:border-line-strong hover:shadow-lift',
                  (busy || !data.verified) && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl transition-colors',
                    pending ? 'bg-accent text-white shadow-xs' : 'bg-stone-100 text-ink-soft group-hover:bg-accent-soft group-hover:text-accent-strong',
                  )}
                >
                  {pending ? <Check className="size-4 stroke-[3]" /> : <Icon className="size-5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink">{label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                    {pending ? 'Staff notified' : hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-line/75 bg-surface p-4 shadow-subtle">
          <label htmlFor="request-note" className="mb-1.5 block text-xs font-semibold text-ink-soft">
            Add a note <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <Textarea
            id="request-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Special instructions before your server comes over…"
            rows={2}
            maxLength={280}
            className="rounded-xl border-line/80 focus:border-accent"
          />
        </div>

        <section className="mt-6">
          <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-ink-soft">
            Your requests
          </h2>

          {requests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line/80 bg-surface/50 px-4 py-8 text-center">
              <BellRing className="mx-auto mb-2 size-5 text-ink-muted" aria-hidden />
              <p className="text-sm font-semibold text-ink">No pending requests</p>
              <p className="mt-1 text-xs text-ink-muted">Tap any service tile above if you need assistance.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {requests.map((request) => (
                <li
                  key={request.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line/75 bg-surface px-4 py-3.5 shadow-subtle"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink">{request.label}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {relativeTime(request.createdAt)}
                      {request.note ? ` · “${request.note}”` : ''}
                    </p>
                  </div>
                  <RequestStatusBadge status={request.status} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
