import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChefHat, Lock, Mail, Utensils } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Field, Input } from '@/components/ui/primitives';

const DEMO_ACCOUNTS = [
  { email: 'owner@tableflow.local', label: 'Owner' },
  { email: 'manager@tableflow.local', label: 'Manager' },
  { email: 'waiter@tableflow.local', label: 'Waiter' },
  { email: 'kitchen@tableflow.local', label: 'Kitchen' },
  { email: 'cashier@tableflow.local', label: 'Cashier' },
  { email: 'inventory@tableflow.local', label: 'Inventory' },
];

const DEMO_PASSWORD = 'TableFlow!2024';

/** Where each role lands after signing in. */
function homeFor(role: string): string {
  switch (role) {
    case 'KITCHEN':
      return '/staff/kitchen';
    case 'WAITER':
      return '/staff/waiter';
    case 'CASHIER':
      return '/staff/billing';
    case 'INVENTORY':
      return '/admin/inventory';
    default:
      return '/admin';
  }
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      navigate(from ?? homeFor(user.role), { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'We could not sign you in. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const applyDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  };

  return (
    <div className="flex min-h-[100dvh] bg-canvas">
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-[46%] lg:px-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-sm"
        >
          <div className="mb-9 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-ink text-ink-inverse">
              <Utensils className="size-5" strokeWidth={1.8} aria-hidden />
            </div>
            <div>
              <p className="font-display text-base font-semibold leading-none text-ink">TableFlow</p>
              <p className="mt-1 text-2xs tracking-wide text-ink-muted">Scan. Order. Serve.</p>
            </div>
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-sm text-ink-muted">Staff and management access.</p>

          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            <Field label="Email" htmlFor="email">
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                  aria-hidden
                />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@restaurant.com"
                  className="pl-9"
                  invalid={Boolean(error)}
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password" error={error}>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                  aria-hidden
                />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="pl-9"
                  invalid={Boolean(error)}
                />
              </div>
            </Field>

            <Button type="submit" size="lg" fullWidth loading={submitting}>
              Sign in
            </Button>
          </form>

          <div className="mt-8 rounded-lg border border-line bg-surface-sunken/60 p-4">
            <div className="flex items-center justify-between">
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">Demo accounts</p>
              <span className="text-2xs font-medium text-accent-strong">Tab-isolated</span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => applyDemoAccount(account.email)}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-accent/40 hover:text-accent-strong"
                >
                  {account.label}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-2xs text-ink-muted">
              Password <code className="tabular font-medium text-ink-soft">{DEMO_PASSWORD}</code> — Open multiple tabs to test Owner, Waiter & Kitchen at the same time.
            </p>
          </div>
        </motion.div>
      </div>

      <aside className="relative hidden flex-1 overflow-hidden bg-ink lg:block">
        <div className="absolute inset-0 opacity-[0.07]">
          <div className="absolute -left-24 top-16 size-96 rounded-full bg-accent blur-3xl" />
          <div className="absolute bottom-10 right-0 size-80 rounded-full bg-gold blur-3xl" />
        </div>
        <div className="relative flex h-full flex-col justify-between p-14 text-white">
          <ChefHat className="size-8 opacity-60" strokeWidth={1.4} aria-hidden />
          <div>
            <p className="font-display text-3xl font-semibold leading-tight tracking-tight">
              Every order, table and request — live, in one place.
            </p>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
              The kitchen display, the waiter's floor plan and the owner's dashboard all read from the same
              source of truth, updated the moment something changes.
            </p>
          </div>
          <p className="text-2xs uppercase tracking-[0.18em] text-white/35">TableFlow</p>
        </div>
      </aside>
    </div>
  );
}
