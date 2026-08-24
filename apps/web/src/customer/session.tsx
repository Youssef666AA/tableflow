import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OpenState } from '@tableflow/shared';
import {
  ApiError,
  api,
  deviceKey,
  isSessionLifecycleError,
  onCustomerSessionLost,
  request,
  sessionTokens,
} from '@/lib/api';
import { useSocket } from '@/lib/hooks';
import { useToast } from '@/components/ui/overlays';

export interface CustomerSessionPayload {
  session: {
    id: string;
    code: string;
    status: string;
    startedAt: string;
    expiresAt: string;
    guestCount: number;
    customerName: string | null;
  };
  verified: boolean;
  requiresLocation: boolean;
  demoMode: boolean;
  table: { id: string; number: string; label: string | null; seats: number };
  branch: {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    latitude: number;
    longitude: number;
    serviceRadiusMeters: number;
    allowStaffLocationOverride: boolean;
  };
  restaurant: { id: string; name: string; logoUrl: string | null; currency: string };
  openState: OpenState;
  counts: { activeOrders: number; openRequests: number };
}

interface StartResponse extends Omit<CustomerSessionPayload, 'counts'> {
  sessionToken: string;
  device: { id: string; key: string; verified: boolean };
}

interface SessionContextValue {
  qrToken: string;
  sessionToken: string;
  data: CustomerSessionPayload;
  currency: string;
  refresh: () => Promise<unknown>;
  reset: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a CustomerSessionProvider');
  return context;
}

/** Convenience accessor used all over the customer UI. */
export function useSessionAuth(): { session: string } {
  const { sessionToken } = useSession();
  return useMemo(() => ({ session: sessionToken }), [sessionToken]);
}

type BootState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; sessionToken: string; initial: StartResponse };

/**
 * A session that ends while the guest is mid-visit should not strand them.
 * We will silently open a fresh one a couple of times; beyond that something is
 * genuinely wrong and the guest deserves to be told rather than watch the app
 * loop.
 */
const MAX_AUTO_RECOVERIES = 2;

export function CustomerSessionProvider({
  qrToken,
  children,
  renderError,
  renderLoading,
}: {
  qrToken: string;
  children: (value: SessionContextValue) => ReactNode;
  renderError: (error: ApiError, retry: () => void) => ReactNode;
  renderLoading: () => ReactNode;
}) {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [autoRecoveries, setAutoRecoveries] = useState(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    setBoot({ status: 'loading' });

    (async () => {
      try {
        const response = await request<StartResponse>('/table-sessions/start', {
          method: 'POST',
          body: { token: qrToken, deviceKey: deviceKey() },
        });
        if (cancelled) return;
        sessionTokens.set(qrToken, response.sessionToken);
        setBoot({ status: 'ready', sessionToken: response.sessionToken, initial: response });
      } catch (error) {
        if (cancelled) return;
        sessionTokens.clear(qrToken);
        setBoot({
          status: 'error',
          error:
            error instanceof ApiError
              ? error
              : new ApiError('INTERNAL', 'We could not open this table. Please try again.', 500),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [qrToken, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const reset = useCallback(
    (options?: { auto?: boolean }) => {
      sessionTokens.clear(qrToken);
      // Cart state is keyed by session id, so it falls away with the session.
      queryClient.clear();
      if (options?.auto) setAutoRecoveries((n) => n + 1);
      setAttempt((n) => n + 1);
    },
    [qrToken, queryClient],
  );

  if (boot.status === 'loading') return <>{renderLoading()}</>;
  if (boot.status === 'error') return <>{renderError(boot.error, retry)}</>;

  return (
    <LiveSession
      key={boot.sessionToken}
      qrToken={qrToken}
      sessionToken={boot.sessionToken}
      initial={boot.initial}
      onReset={reset}
      autoRecoveryBudget={MAX_AUTO_RECOVERIES - autoRecoveries}
      renderError={renderError}
      renderLoading={renderLoading}
    >
      {children}
    </LiveSession>
  );
}

/** Expiry is just inactivity — reopening is always the right answer, so we do it
 *  without making the guest tap anything. A closed or blocked session is a
 *  deliberate act by staff and must be shown, not papered over. */
function recoveryFor(code: string): 'auto' | 'explain' {
  return code === 'SESSION_EXPIRED' ? 'auto' : 'explain';
}

function LiveSession({
  qrToken,
  sessionToken,
  initial,
  onReset,
  autoRecoveryBudget,
  children,
  renderError,
  renderLoading,
}: {
  qrToken: string;
  sessionToken: string;
  initial: StartResponse;
  onReset: (options?: { auto?: boolean }) => void;
  autoRecoveryBudget: number;
  children: (value: SessionContextValue) => ReactNode;
  renderError: (error: ApiError, retry: () => void) => ReactNode;
  renderLoading: () => ReactNode;
}) {
  const auth = useMemo(() => ({ session: sessionToken }), [sessionToken]);
  const socket = useSocket('customer', sessionToken);
  const queryClient = useQueryClient();
  const toast = useToast();

  // Set the moment ANY customer request is refused for a lifecycle reason, from
  // whichever screen made it. This is what stops a dead session from surfacing as
  // a per-page "Something went wrong".
  const [lost, setLost] = useState<ApiError | null>(null);

  const query = useQuery({
    queryKey: ['customer', 'session', sessionToken],
    queryFn: () => api.get<CustomerSessionPayload>('/customer/session', auth),
    initialData: { ...initial, counts: { activeOrders: 0, openRequests: 0 } },
    refetchInterval: 60_000,
    staleTime: 10_000,
    // A flaky connection must not permanently strand a perfectly live session:
    // only a lifecycle refusal is terminal, everything else is worth retrying.
    retry: (failureCount, error) => !isSessionLifecycleError(error) && failureCount < 3,
  });

  useEffect(() => {
    return onCustomerSessionLost((event) => {
      // Ignore refusals aimed at a token we have already replaced.
      if (event.sessionToken !== sessionToken) return;
      setLost((current) => current ?? event.error);
    });
  }, [sessionToken]);

  // Session lifecycle changes (staff closing the table, expiry) arrive live.
  useEffect(() => {
    if (!socket) return;
    const handler = () => {
      void queryClient.invalidateQueries({ queryKey: ['customer'] });
    };
    socket.on('session:updated', handler);
    return () => {
      socket.off('session:updated', handler);
    };
  }, [socket, queryClient]);

  const recoverable = lost !== null && recoveryFor(lost.code) === 'auto' && autoRecoveryBudget > 0;

  useEffect(() => {
    if (!recoverable) return;
    toast.info('We reopened your table', 'The previous session had timed out.');
    onReset({ auto: true });
  }, [recoverable, onReset, toast]);

  if (lost) {
    // While the reopen is in flight, show the boot screen rather than an error
    // the guest never needs to read.
    if (recoverable) return <>{renderLoading()}</>;
    return <>{renderError(lost, () => onReset())}</>;
  }

  if (query.isError) {
    const error =
      query.error instanceof ApiError
        ? query.error
        : new ApiError('INTERNAL', 'We lost your table session.', 500);
    return <>{renderError(error, () => onReset())}</>;
  }

  if (!query.data) return <>{renderLoading()}</>;

  const value: SessionContextValue = {
    qrToken,
    sessionToken,
    data: query.data,
    currency: query.data.restaurant.currency,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['customer'] }),
    reset: () => onReset(),
  };

  return <SessionContext.Provider value={value}>{children(value)}</SessionContext.Provider>;
}
