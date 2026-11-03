import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, QrCode, ScanLine, ShieldOff, Utensils } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { Button, Spinner } from '@/components/ui/primitives';
import { useOnlineStatus } from '@/lib/hooks';
import { CartProvider } from './cart';
import { CustomerSessionProvider, useSession } from './session';
import { BottomNav, CartBar, RestaurantHeader } from './components/shell';
import MenuPage from './pages/MenuPage';
import CartPage from './pages/CartPage';
import OrdersPage from './pages/OrdersPage';
import OrderTrackingPage from './pages/OrderTrackingPage';
import ServicesPage from './pages/ServicesPage';
import BillPage from './pages/BillPage';
import ReceiptPage from './pages/ReceiptPage';
import ReviewPage from './pages/ReviewPage';
import VerifyPage from './pages/VerifyPage';

export default function CustomerApp() {
  const { token } = useParams<{ token: string }>();

  if (!token) return <Navigate to="/" replace />;

  return (
    <CustomerSessionProvider
      qrToken={token}
      renderLoading={() => <BootScreen />}
      renderError={(error, retry) => <SessionErrorScreen error={error} onRetry={retry} />}
    >
      {() => (
        <CartProvider>
          <CustomerShell />
        </CartProvider>
      )}
    </CustomerSessionProvider>
  );
}

function CustomerShell() {
  const { data } = useSession();
  const location = useLocation();
  const online = useOnlineStatus();

  // Until this device has proven it is at the table, verification is the only page.
  if (!data.verified && !location.pathname.endsWith('/verify')) {
    return <Navigate to="verify" replace />;
  }

  const onVerifyPage = location.pathname.endsWith('/verify');
  // Checkout is a focused flow: its own sticky action bar replaces the tab bar,
  // which would otherwise sit on top of the "Place order" button.
  const onCartPage = location.pathname.endsWith('/cart');
  const showChrome = !onVerifyPage && !onCartPage;

  return (
    <div className="min-h-[100dvh] bg-canvas sm:bg-[#F3EFEA] sm:py-6 sm:px-4">
      <div className="relative mx-auto min-h-[100dvh] max-w-phone overflow-x-hidden bg-canvas sm:min-h-[calc(100dvh-3rem)] sm:rounded-[2.5rem] sm:border sm:border-line/60 sm:shadow-float">
        {!online && (
          <div className="sticky top-0 z-40 bg-warning px-4 py-2 text-center text-xs font-medium text-white">
            You appear to be offline — orders cannot be sent right now.
          </div>
        )}

        {!onVerifyPage && <RestaurantHeader />}

        <AnimatePresence mode="wait">
          <motion.main
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <Routes location={location}>
              <Route index element={<Navigate to="menu" replace />} />
              <Route path="verify" element={<VerifyPage />} />
              <Route path="menu" element={<MenuPage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="order/:orderId" element={<OrderTrackingPage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="bill" element={<BillPage />} />
              <Route path="receipt/:receiptId" element={<ReceiptPage />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="*" element={<Navigate to="menu" replace />} />
            </Routes>
          </motion.main>
        </AnimatePresence>

        {showChrome && (
          <>
            <CartBar />
            <BottomNav />
          </>
        )}
      </div>
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-canvas px-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-ink text-ink-inverse">
        <Utensils className="size-6" strokeWidth={1.7} aria-hidden />
      </div>
      <div>
        <p className="font-display text-lg font-semibold text-ink">Opening your table…</p>
        <p className="mt-1 text-sm text-ink-muted">One moment.</p>
      </div>
      <Spinner />
    </div>
  );
}

const ERROR_SCREENS: Record<
  string,
  { Icon: typeof QrCode; title: string; body: string; retry: string | null }
> = {
  QR_INVALID: {
    Icon: QrCode,
    title: 'We do not recognise this code',
    body: 'This QR code is not linked to a table. Please scan the code printed on your table, or ask a member of staff.',
    retry: null,
  },
  QR_REVOKED: {
    Icon: ScanLine,
    title: 'This table QR code is no longer active',
    body: 'The restaurant has issued a new code for this table. Please ask a member of staff for the current one.',
    retry: null,
  },
  SESSION_EXPIRED: {
    Icon: Clock,
    title: 'Your table session has expired',
    body: 'Sessions close automatically after a period of inactivity. Scan the QR code at your table to start again.',
    retry: 'Start a new session',
  },
  SESSION_CLOSED: {
    Icon: Clock,
    title: 'This table session has been closed',
    body: 'The bill has been settled and the table released. Scan again to start a fresh visit.',
    retry: 'Start a new session',
  },
  SESSION_BLOCKED: {
    Icon: ShieldOff,
    title: 'Please ask a member of staff',
    body: 'This session has been blocked. A member of staff can help you order.',
    retry: null,
  },
  RESTAURANT_CLOSED: {
    Icon: Clock,
    title: 'This location is closed',
    body: 'The restaurant is not accepting orders at the moment. Please try again during opening hours.',
    retry: 'Try again',
  },
};

function SessionErrorScreen({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const screen = ERROR_SCREENS[error.code] ?? {
    Icon: QrCode,
    title: "We couldn't open your table",
    body: error.message,
    retry: 'Try again',
  };
  const { Icon } = screen;

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm"
      >
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-surface-sunken text-ink-muted">
          <Icon className="size-6" strokeWidth={1.7} aria-hidden />
        </div>
        <h1 className="font-display text-[1.375rem] font-semibold leading-tight text-ink">{screen.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{screen.body}</p>

        {screen.retry && (
          <Button size="lg" fullWidth className="mt-7" onClick={onRetry}>
            {screen.retry}
          </Button>
        )}

        <p className="mt-8 text-2xs uppercase tracking-[0.14em] text-ink-muted">TableFlow</p>
      </motion.div>
    </div>
  );
}
