import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ChefHat, LayoutDashboard, QrCode, Smartphone } from 'lucide-react';

const ENTRY_POINTS = [
  {
    to: '/dev/qr',
    title: 'QR Test Center',
    description: 'Pick a branch and a table, then open the guest experience exactly as a scanned code would.',
    Icon: QrCode,
    tone: 'accent' as const,
  },
  {
    to: '/staff/login',
    title: 'Staff',
    description: 'Kitchen display, waiter floor plan, table service and billing.',
    Icon: ChefHat,
    tone: 'neutral' as const,
  },
  {
    to: '/admin',
    title: 'Management',
    description: 'Menu, tables and QR codes, inventory, employees, analytics and settings.',
    Icon: LayoutDashboard,
    tone: 'neutral' as const,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-canvas">
      <div className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-8 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-ink text-ink-inverse">
              <Smartphone className="size-5" strokeWidth={1.8} aria-hidden />
            </div>
            <div>
              <p className="font-display text-lg font-semibold leading-none text-ink">TableFlow</p>
              <p className="mt-1 text-xs tracking-wide text-ink-muted">Scan. Order. Serve.</p>
            </div>
          </div>

          <h1 className="max-w-2xl font-display text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
            QR ordering and restaurant operations, in one place.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted">
            A guest scans the code on their table, orders in seconds and follows the kitchen live. Staff see
            every order, request and table in real time. Owners see what it all adds up to.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-3 sm:grid-cols-3">
          {ENTRY_POINTS.map(({ to, title, description, Icon, tone }, index) => (
            <motion.div
              key={to}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.06 * index, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link
                to={to}
                className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 shadow-subtle transition-all hover:shadow-lift"
              >
                <span
                  className={`mb-4 flex size-10 items-center justify-center rounded-md ${
                    tone === 'accent' ? 'bg-accent-soft text-accent-strong' : 'bg-surface-sunken text-ink-soft'
                  }`}
                >
                  <Icon className="size-[1.125rem]" aria-hidden />
                </span>
                <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-muted">{description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-strong">
                  Open
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="mt-12 rounded-lg border border-line bg-surface-sunken/60 p-5">
          <h2 className="text-sm font-semibold text-ink">Demo accounts</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Every seeded account uses the password <code className="tabular font-medium text-ink">TableFlow!2024</code>.
          </p>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-xs text-ink-muted sm:grid-cols-2">
            {[
              ['owner@tableflow.local', 'Owner — everything'],
              ['manager@tableflow.local', 'Manager — operations'],
              ['waiter@tableflow.local', 'Waiter — floor & requests'],
              ['kitchen@tableflow.local', 'Kitchen — the display'],
              ['cashier@tableflow.local', 'Cashier — billing'],
              ['inventory@tableflow.local', 'Inventory — stock'],
            ].map(([email, role]) => (
              <li key={email} className="flex items-baseline gap-2">
                <code className="tabular font-medium text-ink-soft">{email}</code>
                <span className="truncate">{role}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
