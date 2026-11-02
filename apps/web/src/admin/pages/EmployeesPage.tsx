import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserPlus, Users } from 'lucide-react';
import { ROLES, ROLE_PERMISSIONS, type Role } from '@tableflow/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { formatDate, initialsOf, relativeTime, titleCase } from '@/lib/format';
import { Badge, Button, Field, Input, Select, Switch } from '@/components/ui/primitives';
import { DataTable, FilterBar, type Column } from '@/components/ui/data';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { SidePanel, useToast } from '@/components/ui/overlays';
import { Page, PageHeading } from '@/console/PageShell';
import type { AdminEmployee } from '../types';

const ROLE_TONES: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  OWNER: 'gold',
  ADMIN: 'accent',
  MANAGER: 'info',
  WAITER: 'neutral',
  KITCHEN: 'neutral',
  CASHIER: 'neutral',
  INVENTORY: 'neutral',
};

interface Draft {
  email: string;
  fullName: string;
  password: string;
  role: Role;
  position: string;
  phone: string;
  branchIds: string[];
  active: boolean;
}

const EMPTY: Draft = {
  email: '',
  fullName: '',
  password: '',
  role: 'WAITER',
  position: '',
  phone: '',
  branchIds: [],
  active: true,
};

export default function EmployeesPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminEmployee | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const debouncedSearch = useDebounced(search, 250);

  const query = useQuery({
    queryKey: ['employees', debouncedSearch],
    queryFn: () =>
      api.get<{ employees: AdminEmployee[] }>(
        `/employees${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`,
      ),
  });

  const save = useMutation({
    mutationFn: () => {
      if (editing) {
        return api.put(`/employees/${editing.membershipId}`, {
          fullName: draft.fullName.trim(),
          role: draft.role,
          branchIds: draft.branchIds,
          phone: draft.phone.trim() || null,
          position: draft.position.trim() || null,
          active: draft.active,
          ...(draft.password ? { password: draft.password } : {}),
        });
      }
      return api.post('/employees', {
        email: draft.email.trim(),
        fullName: draft.fullName.trim(),
        password: draft.password,
        role: draft.role,
        branchIds: draft.branchIds,
        phone: draft.phone.trim() || null,
        position: draft.position.trim() || null,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      setOpen(false);
      toast.success(editing ? 'Employee updated' : 'Employee added');
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldIssues.length > 0) {
        setErrors(Object.fromEntries(error.fieldIssues.map((issue) => [issue.field, issue.message])));
      }
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.');
    },
  });

  const deactivate = useMutation({
    mutationFn: () => api.del(`/employees/${editing?.membershipId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      setOpen(false);
      toast.success('Access revoked', 'They are signed out of every device.');
    },
    onError: (error) =>
      toast.error('Could not revoke', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const openEditor = (employee: AdminEmployee | null) => {
    setErrors({});
    setEditing(employee);
    setDraft(
      employee
        ? {
            email: employee.email,
            fullName: employee.fullName,
            password: '',
            role: employee.role as Role,
            position: employee.position ?? '',
            phone: employee.phone ?? '',
            branchIds: employee.branches.map((branch) => branch.id),
            active: employee.active,
          }
        : { ...EMPTY, branchIds: user?.branches[0] ? [user.branches[0].id] : [] },
    );
    setOpen(true);
  };

  const baseColumns: Column<AdminEmployee>[] = [
    {
      key: 'name',
      header: 'Employee',
      render: (employee) => (
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-2xs font-semibold text-ink-soft">
            {initialsOf(employee.fullName)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{employee.fullName}</p>
            <p className="truncate text-2xs text-ink-muted">{employee.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (employee) => (
        <Badge tone={ROLE_TONES[employee.role] ?? 'neutral'} size="sm">
          {titleCase(employee.role)}
        </Badge>
      ),
    },
    {
      key: 'position',
      header: 'Position',
      hideOnMobile: true,
      render: (employee) => <span className="text-ink-soft">{employee.position ?? '—'}</span>,
    },
    {
      key: 'branches',
      header: 'Branches',
      hideOnMobile: true,
      render: (employee) => (
        <span className="text-xs text-ink-muted">
          {employee.allBranches ? 'All branches' : employee.branches.map((branch) => branch.name).join(', ')}
        </span>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      hideOnMobile: true,
      align: 'right',
      render: (employee) => (
        <span className="text-xs text-ink-muted">
          {employee.lastLoginAt ? relativeTime(employee.lastLoginAt) : 'never'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (employee) => (
        <Badge tone={employee.active ? 'success' : 'danger'} size="sm" dot>
          {employee.active ? 'Active' : 'Revoked'}
        </Badge>
      ),
    },
  ];

  const columns =
    (user?.branches.length ?? 0) > 1 ? baseColumns : baseColumns.filter((col) => col.key !== 'branches');

  const permissionCount = ROLE_PERMISSIONS[draft.role]?.length ?? 0;

  return (
    <Page>
      <PageHeading
        title="Employees"
        description="Roles decide what each person can see and do — the API enforces the same rules."
        actions={
          can('employees:manage') && (
            <Button leadingIcon={<UserPlus className="size-4" />} onClick={() => openEditor(null)}>
              Add employee
            </Button>
          )
        }
      />

      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search name or email…" className="mb-4" />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={query.data?.employees ?? []}
          rowKey={(employee) => employee.membershipId}
          loading={query.isLoading}
          onRowClick={can('employees:manage') ? openEditor : undefined}
          empty={
            <EmptyState
              icon={<Users className="size-5" />}
              title="No employees match"
              description="Try a different search."
              compact
            />
          }
        />
      )}

      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        width="sm"
        title={editing ? editing.fullName : 'New employee'}
        description={editing ? editing.email : 'They can sign in at /staff/login straight away.'}
        footer={
          <div className="flex items-center justify-between gap-3">
            {editing && editing.id !== user?.id && (
              <Button variant="ghost" size="sm" loading={deactivate.isPending} onClick={() => deactivate.mutate()}>
                Revoke access
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {!editing && (
            <Field label="Email" htmlFor="e-email" required error={errors.email}>
              <Input
                id="e-email"
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                placeholder="name@restaurant.com"
                invalid={Boolean(errors.email)}
              />
            </Field>
          )}

          <Field label="Full name" htmlFor="e-name" required error={errors.fullName}>
            <Input
              id="e-name"
              value={draft.fullName}
              onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
              invalid={Boolean(errors.fullName)}
            />
          </Field>

          <Field
            label={editing ? 'New password' : 'Password'}
            htmlFor="e-password"
            required={!editing}
            hint={editing ? 'leave blank to keep' : undefined}
            error={errors.password}
            description="At least 10 characters, with upper and lower case and a number."
          >
            <Input
              id="e-password"
              type="password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              autoComplete="new-password"
              invalid={Boolean(errors.password)}
            />
          </Field>

          <Field label="Role" htmlFor="e-role" required>
            <Select
              id="e-role"
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}
            >
              {ROLES.filter((role) => role !== 'OWNER' || user?.role === 'OWNER').map((role) => (
                <option key={role} value={role}>
                  {titleCase(role)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-start gap-2.5 rounded-md bg-surface-sunken px-3.5 py-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <p className="text-xs leading-relaxed text-ink-muted">
              A <strong className="text-ink-soft">{titleCase(draft.role).toLowerCase()}</strong> holds{' '}
              {permissionCount} permissions. Every request they make is re-checked on the server.
            </p>
          </div>

          <Field label="Position" htmlFor="e-position" hint="optional">
            <Input
              id="e-position"
              value={draft.position}
              onChange={(event) => setDraft({ ...draft, position: event.target.value })}
              placeholder="Head waiter"
            />
          </Field>

          <Field label="Phone" htmlFor="e-phone" hint="optional">
            <Input
              id="e-phone"
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </Field>

          {(user?.branches.length ?? 0) > 1 && (
            <Field label="Branches" description="Leave all unchecked to grant every branch.">
              <div className="space-y-1.5">
                {user?.branches.map((branch) => (
                  <label key={branch.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={draft.branchIds.includes(branch.id)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          branchIds: event.target.checked
                            ? [...draft.branchIds, branch.id]
                            : draft.branchIds.filter((id) => id !== branch.id),
                        })
                      }
                      className="size-4 rounded border-line-strong text-accent focus:ring-accent/40"
                    />
                    {branch.name}
                  </label>
                ))}
              </div>
            </Field>
          )}

          {editing && (
            <>
              <Switch
                checked={draft.active}
                onChange={(value) => setDraft({ ...draft, active: value })}
                label="Account active"
                description="Turning this off signs them out everywhere."
              />
              <p className="text-2xs text-ink-muted">
                Joined {editing.hiredAt ? formatDate(editing.hiredAt) : formatDate(editing.createdAt)}
              </p>
            </>
          )}
        </div>
      </SidePanel>
    </Page>
  );
}
