import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, Role } from '@tableflow/shared';
import { api, onStaffUnauthorized, staffTokens } from './api';

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  role: Role;
  permissions: Permission[];
  membershipId: string;
  restaurant: { id: string; name: string; currency: string; logoUrl: string | null };
  branches: Array<{ id: string; name: string; slug: string; timezone: string }>;
}

interface AuthContextValue {
  user: StaffUser | null;
  loading: boolean;
  currency: string;
  /** The branch the console is currently scoped to. */
  branchId: string;
  branchName: string;
  setBranchId: (id: string) => void;
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
  login: (email: string, password: string) => Promise<StaffUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const BRANCH_KEY = 'tf.staff.branch';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [hasToken, setHasToken] = useState(() => Boolean(staffTokens.access()));
  const [branchId, setBranchIdState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(BRANCH_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ user: StaffUser }>('/auth/me'),
    enabled: hasToken,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const user = query.data?.user ?? null;

  // A revoked or expired session anywhere in the app drops us back to sign-in.
  useEffect(
    () =>
      onStaffUnauthorized(() => {
        setHasToken(false);
        queryClient.clear();
      }),
    [queryClient],
  );

  // Keep the selected branch valid for whoever is signed in.
  useEffect(() => {
    if (!user) return;
    const allowed = user.branches.map((branch) => branch.id);
    if (allowed.length === 0) return;
    if (!allowed.includes(branchId)) {
      const next = allowed[0];
      setBranchIdState(next);
      try {
        window.localStorage.setItem(BRANCH_KEY, next);
      } catch {
        // Non-fatal: the choice simply will not persist.
      }
    }
  }, [user, branchId]);

  const setBranchId = useCallback(
    (id: string) => {
      setBranchIdState(id);
      try {
        window.localStorage.setItem(BRANCH_KEY, id);
      } catch {
        // Non-fatal.
      }
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.post<{ accessToken: string; refreshToken: string; user: StaffUser }>(
        '/auth/login',
        { email, password },
        'none',
      );
      staffTokens.set(result.accessToken, result.refreshToken);
      setHasToken(true);
      queryClient.setQueryData(['auth', 'me'], { user: result.user });
      const firstBranch = result.user.branches[0]?.id ?? '';
      if (firstBranch && !result.user.branches.some((branch) => branch.id === branchId)) {
        setBranchId(firstBranch);
      }
      return result.user;
    },
    [queryClient, branchId, setBranchId],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: staffTokens.refresh() });
    } catch {
      // Signing out locally matters more than the round trip succeeding.
    }
    staffTokens.clear();
    setHasToken(false);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(user?.permissions ?? []);
    const branch = user?.branches.find((item) => item.id === branchId) ?? user?.branches[0];

    return {
      user,
      loading: hasToken && query.isLoading,
      currency: user?.restaurant.currency ?? 'TND',
      branchId: branch?.id ?? '',
      branchName: branch?.name ?? '',
      setBranchId,
      can: (permission) => permissions.has(permission),
      canAny: (...list) => list.some((permission) => permissions.has(permission)),
      login,
      logout,
      refresh: () => query.refetch(),
    };
  }, [user, hasToken, query, branchId, setBranchId, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

/** Convenience: the signed-in user, asserted non-null inside guarded routes. */
export function useStaff(): StaffUser {
  const { user } = useAuth();
  if (!user) throw new Error('useStaff used outside an authenticated route');
  return user;
}
