import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from './components/ui/primitives';

const CustomerApp = lazy(() => import('./customer/CustomerApp'));
const StaffApp = lazy(() => import('./staff/StaffApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const QrTestCenter = lazy(() => import('./pages/QrTestCenter'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

/**
 * The three experiences are separate route trees with separate bundles: a guest
 * on a phone never downloads the analytics console, and the kitchen display
 * never loads the customer cart.
 */
function RouteBoundary() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
      <Spinner className="size-6" />
    </div>
  );
}

/** Each surface re-themes the document root; see styles/index.css. */
function SurfaceTheme() {
  const { pathname } = useLocation();

  useEffect(() => {
    const surface = pathname.startsWith('/t/')
      ? 'customer'
      : pathname.startsWith('/staff/kitchen')
        ? 'kitchen'
        : 'default';
    document.documentElement.dataset.surface = surface;

    const themeColor = surface === 'kitchen' ? '#0F1211' : surface === 'customer' ? '#FBF8F4' : '#F6F7F8';
    document
      .querySelector('meta[name="theme-color"]:not([media])')
      ?.setAttribute('content', themeColor);
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <>
      <SurfaceTheme />
      <Suspense fallback={<RouteBoundary />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/t/:token/*" element={<CustomerApp />} />
          <Route path="/staff/*" element={<StaffApp />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/dev/qr" element={<QrTestCenter />} />
          <Route path="/dev" element={<Navigate to="/dev/qr" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
