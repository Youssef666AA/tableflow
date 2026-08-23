import { Route, Routes, useLocation } from 'react-router-dom';
import {
  BarChart3,
  ClipboardList,
  LayoutDashboard,
  Package,
  QrCode,
  Settings,
  Star,
  Table2,
  Tag,
  UtensilsCrossed,
  Users,
} from 'lucide-react';
import { AuthProvider } from '@/lib/auth';
import { ConsoleLayout, type NavSection } from '@/console/ConsoleLayout';
import { RequireAuth, RequirePermission } from '@/console/guards';
import StaffOrdersPage from '@/staff/pages/OrdersPage';
import AdminDashboardPage from './pages/DashboardPage';
import AdminMenuPage from './pages/MenuPage';
import AdminTablesPage from './pages/TablesPage';
import QrPage from './pages/QrPage';
import InventoryPage from './pages/InventoryPage';
import EmployeesPage from './pages/EmployeesPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ReviewsPage from './pages/ReviewsPage';
import PromotionsPage from './pages/PromotionsPage';
import SettingsPage from './pages/SettingsPage';

const SECTIONS: NavSection[] = [
  {
    items: [
      { to: '/admin', label: 'Dashboard', Icon: LayoutDashboard, end: true, permission: 'dashboard:view' },
      { to: '/admin/analytics', label: 'Analytics', Icon: BarChart3, permission: 'analytics:view' },
      { to: '/admin/orders', label: 'Orders', Icon: ClipboardList, permission: 'orders:view' },
    ],
  },
  {
    label: 'Restaurant',
    items: [
      { to: '/admin/menu', label: 'Menu', Icon: UtensilsCrossed, permission: 'menu:view' },
      { to: '/admin/tables', label: 'Tables', Icon: Table2, permission: 'tables:view' },
      { to: '/admin/qr', label: 'QR codes', Icon: QrCode, permission: 'tables:qr_manage' },
      { to: '/admin/inventory', label: 'Inventory', Icon: Package, permission: 'inventory:view' },
      { to: '/admin/promotions', label: 'Promotions', Icon: Tag, permission: 'promotions:view' },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/admin/employees', label: 'Employees', Icon: Users, permission: 'employees:view' },
      { to: '/admin/reviews', label: 'Reviews', Icon: Star, permission: 'reviews:view' },
      { to: '/admin/settings', label: 'Settings', Icon: Settings, permission: 'settings:view' },
    ],
  },
];

const TITLES: Record<string, string> = {
  '/admin': 'Dashboard',
  '/admin/analytics': 'Analytics',
  '/admin/orders': 'Orders',
  '/admin/menu': 'Menu',
  '/admin/tables': 'Tables',
  '/admin/qr': 'QR codes',
  '/admin/inventory': 'Inventory',
  '/admin/promotions': 'Promotions',
  '/admin/employees': 'Employees',
  '/admin/reviews': 'Reviews',
  '/admin/settings': 'Settings',
};

function AdminChrome({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ConsoleLayout sections={SECTIONS} title={TITLES[pathname] ?? 'Management'}>
      {children}
    </ConsoleLayout>
  );
}

/** Every page is wrapped once; permissions are re-checked server-side regardless. */
function Guarded({
  permission,
  children,
}: {
  permission: Parameters<typeof RequirePermission>[0]['permission'];
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <AdminChrome>
        <RequirePermission permission={permission}>{children}</RequirePermission>
      </AdminChrome>
    </RequireAuth>
  );
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <Routes>
        <Route index element={<Guarded permission="dashboard:view"><AdminDashboardPage /></Guarded>} />
        <Route path="analytics" element={<Guarded permission="analytics:view"><AnalyticsPage /></Guarded>} />
        <Route path="orders" element={<Guarded permission="orders:view"><StaffOrdersPage /></Guarded>} />
        <Route path="menu" element={<Guarded permission="menu:view"><AdminMenuPage /></Guarded>} />
        <Route path="tables" element={<Guarded permission="tables:view"><AdminTablesPage /></Guarded>} />
        <Route path="qr" element={<Guarded permission="tables:qr_manage"><QrPage /></Guarded>} />
        <Route path="inventory" element={<Guarded permission="inventory:view"><InventoryPage /></Guarded>} />
        <Route path="promotions" element={<Guarded permission="promotions:view"><PromotionsPage /></Guarded>} />
        <Route path="employees" element={<Guarded permission="employees:view"><EmployeesPage /></Guarded>} />
        <Route path="reviews" element={<Guarded permission="reviews:view"><ReviewsPage /></Guarded>} />
        <Route path="settings" element={<Guarded permission="settings:view"><SettingsPage /></Guarded>} />
      </Routes>
    </AuthProvider>
  );
}
