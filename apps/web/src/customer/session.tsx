import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OpenState } from '@tableflow/shared';
import { ApiError, api, deviceKey, request, sessionTokens } from '@/lib/api';
import { useSocket } from '@/lib/hooks';

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

  if (boot.status === 'loading') return <>{renderLoading()}</>;
  if (boot.status === 'error') return <>{renderError(boot.error, retry)}</>;

  return (
    <LiveSession
      qrToken={qrToken}
      sessionToken={boot.sessionToken}
      initial={boot.initial}
      onReset={() => {
        sessionTokens.clear(qrToken);
        queryClient.clear();
        retry();
      }}
      renderError={renderError}
      renderLoading={renderLoading}
    >
      {children}
    </LiveSession>
  );
}

function LiveSession({
  qrToken,
  sessionToken,
  initial,
  onReset,
  children,
  renderError,
  renderLoading,
}: {
  qrToken: string;
  sessionToken: string;
  initial: StartResponse;
  onReset: () => void;
  children: (value: SessionContextValue) => ReactNode;
  renderError: (error: ApiError, retry: () => void) => ReactNode;
  renderLoading: () => ReactNode;
}) {
  const auth = useMemo(() => ({ session: sessionToken }), [sessionToken]);
  const socket = useSocket('customer', sessionToken);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['customer', 'session', sessionToken],
    queryFn: () => api.get<CustomerSessionPayload>('/customer/session', auth),
    initialData: { ...initial, counts: { activeOrders: 0, openRequests: 0 } },
    refetchInterval: 60_000,
    staleTime: 10_000,
  });

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

  if (query.isError) {
    const error =
      query.error instanceof ApiError
        ? query.error
        : new ApiError('INTERNAL', 'We lost your table session.', 500);
    return <>{renderError(error, onReset)}</>;
  }

  if (!query.data) return <>{renderLoading()}</>;

  const value: SessionContextValue = {
    qrToken,
    sessionToken,
    data: query.data,
    currency: query.data.restaurant.currency,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['customer'] }),
    reset: onReset,
  };

  return <SessionContext.Provider value={value}>{children(value)}</SessionContext.Provider>;
}
