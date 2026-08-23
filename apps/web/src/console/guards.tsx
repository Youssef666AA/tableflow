import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { Permission } from '@tableflow/shared';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-canvas" role="status">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/staff/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}

/**
 * Client-side permission gating is a courtesy, not a control: the API enforces
 * the same rules on every request. This only avoids showing a screen that would
 * come back 403.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can, user } = useAuth();

  if (!can(permission)) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-5 text-warning" />}
        title="You do not have access to this area"
        description={`Your role (${user?.role.toLowerCase() ?? 'unknown'}) cannot open this section. Ask an owner or manager if you need it.`}
        className="py-24"
      />
    );
  }

  return <>{children}</>;
}
