import { Route, Routes } from 'react-router-dom';
import { Bell, ChefHat, ClipboardList, LayoutDashboard, Receipt, Table2 } from 'lucide-react';
import { AuthProvider } from '@/lib/auth';
import { ConsoleLayout, type NavSection } from '@/console/ConsoleLayout';
import { RequireAuth, RequirePermission } from '@/console/guards';
import LoginPage from '@/console/LoginPage';
import StaffDashboardPage from './pages/DashboardPage';
import KitchenPage from './pages/KitchenPage';
import WaiterPage from './pages/WaiterPage';
import StaffOrdersPage from './pages/OrdersPage';
import RequestsPage from './pages/RequestsPage';
import BillingPage from './pages/BillingPage';

const SECTIONS: NavSection[] = [
  {
    items: [
      { to: '/staff', label: 'Overview', Icon: LayoutDashboard, end: true, permission: 'dashboard:view' },
      { to: '/staff/kitchen', label: 'Kitchen', Icon: ChefHat, permission: 'kitchen:view' },
      { to: '/staff/waiter', label: 'Floor', Icon: Table2, permission: 'tables:view' },
    ],
  },
  {
    label: 'Service',
    items: [
      { to: '/staff/orders', label: 'Orders', Icon: ClipboardList, permission: 'orders:view' },
      { to: '/staff/requests', label: 'Requests', Icon: Bell, permission: 'requests:view' },
      { to: '/staff/billing', label: 'Billing', Icon: Receipt, permission: 'billing:view' },
    ],
  },
];

const TITLES: Record<string, string> = {
  '/staff': 'Overview',
  '/staff/waiter': 'Floor',
  '/staff/tables': 'Tables',
  '/staff/orders': 'Orders',
  '/staff/requests': 'Service requests',
  '/staff/billing': 'Billing',
};

function StaffChrome({ children, path }: { children: React.ReactNode; path: string }) {
  return (
    <ConsoleLayout sections={SECTIONS} title={TITLES[path] ?? 'Staff'} compactSidebar>
      {children}
    </ConsoleLayout>
  );
}

/**
 * The staff surface. The kitchen display deliberately sits outside the console
 * chrome — it needs the whole screen and its own dark theme.
 */
export default function StaffApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />

        <Route
          path="kitchen"
          element={
            <RequireAuth>
              <RequirePermission permission="kitchen:view">
                <KitchenPage />
              </RequirePermission>
            </RequireAuth>
          }
        />

        <Route
          index
          element={
            <RequireAuth>
              <StaffChrome path="/staff">
                <StaffDashboardPage />
              </StaffChrome>
            </RequireAuth>
          }
        />

        <Route
          path="waiter"
          element={
            <RequireAuth>
              <StaffChrome path="/staff/waiter">
                <RequirePermission permission="tables:view">
                  <WaiterPage />
                </RequirePermission>
              </StaffChrome>
            </RequireAuth>
          }
        />

        <Route
          path="tables"
          element={
            <RequireAuth>
              <StaffChrome path="/staff/tables">
                <RequirePermission permission="tables:view">
                  <WaiterPage />
                </RequirePermission>
              </StaffChrome>
            </RequireAuth>
          }
        />

        <Route
          path="orders"
          element={
            <RequireAuth>
              <StaffChrome path="/staff/orders">
                <RequirePermission permission="orders:view">
                  <StaffOrdersPage />
                </RequirePermission>
              </StaffChrome>
            </RequireAuth>
          }
        />

        <Route
          path="requests"
          element={
            <RequireAuth>
              <StaffChrome path="/staff/requests">
                <RequirePermission permission="requests:view">
                  <RequestsPage />
                </RequirePermission>
              </StaffChrome>
            </RequireAuth>
          }
        />

        <Route
          path="billing"
          element={
            <RequireAuth>
              <StaffChrome path="/staff/billing">
                <RequirePermission permission="billing:view">
                  <BillingPage />
                </RequirePermission>
              </StaffChrome>
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
