import { Route, Routes } from 'react-router'

import { AuthProvider } from './lib/auth/AuthProvider'
import {
  RequireActiveWarehouse,
  RequireAuth,
  RequireRole,
  RoleRedirect,
} from './features/auth/guards'
import { AppShell } from './features/shell/AppShell'

import { ProfilePage } from './features/auth/ProfilePage'
import { SignInPage } from './features/auth/SignInPage'
import { SignUpPage } from './features/auth/SignUpPage'

import { AdminCatalogPage } from './features/admin/AdminCatalogPage'
import { AdminDashboard } from './features/admin/AdminDashboard'
import { AdminWarehousesPage } from './features/admin/AdminWarehousesPage'

import { NotificationsPage } from './features/notifications/NotificationsPage'
import { PharmacyOrdersPage } from './features/orders/PharmacyOrdersPage'
import { WarehouseIncomingOrdersPage } from './features/orders/WarehouseIncomingOrdersPage'

import { CartPage } from './features/pharmacy/CartPage'
import { PharmacyDashboard } from './features/pharmacy/PharmacyDashboard'

import { WarehouseDashboard } from './features/warehouse/WarehouseDashboard'
import { WarehouseImportPage } from './features/warehouse/WarehouseImportPage'
import { WarehousePendingPage } from './features/warehouse/WarehousePendingPage'
import { WarehouseProductsPage } from './features/warehouse/WarehouseProductsPage'
import { WarehouseReviewsPage } from './features/warehouse/WarehouseReviewsPage'
import { WarehouseSuspendedPage } from './features/warehouse/WarehouseSuspendedPage'

function App() {
  return (
    <AuthProvider>
      <Routes>

        {/* ── Public (no session required) ───────────────────────────────── */}
        <Route element={<SignInPage />} path="/signin" />
        <Route element={<SignUpPage />} path="/signup" />

        {/* ── Root / catch-all: role-aware redirect ──────────────────────── */}
        <Route element={<RoleRedirect />} path="/" />
        <Route element={<RoleRedirect />} path="*" />

        {/* ── Protected ──────────────────────────────────────────────────── */}
        <Route element={<RequireAuth />}>

          {/* Routes rendered inside the shell (header + bottom tab bar) ── */}
          <Route element={<AppShell />}>

            {/* Shared: accessible by any authenticated role */}
            <Route element={<ProfilePage />}       path="/profile" />
            <Route element={<NotificationsPage />} path="/notifications" />

            {/* ── Pharmacy ──────────────────────────────────────────────── */}
            <Route element={<RequireRole role="pharmacy" />}>
              <Route element={<PharmacyDashboard />} path="/app" />
              <Route element={<CartPage />}           path="/cart" />
              <Route element={<PharmacyOrdersPage />} path="/orders" />
            </Route>

            {/* ── Warehouse (active only) ───────────────────────────────── */}
            <Route element={<RequireRole role="warehouse" />}>
              <Route element={<RequireActiveWarehouse />}>
                <Route element={<WarehouseDashboard />}          path="/warehouse" />
                <Route element={<WarehouseImportPage />}         path="/warehouse/import" />
                <Route element={<WarehouseReviewsPage />}        path="/warehouse/reviews" />
                <Route element={<WarehouseProductsPage />}       path="/warehouse/products" />
                <Route element={<WarehouseIncomingOrdersPage />} path="/warehouse/orders" />
              </Route>
            </Route>

            {/* ── Admin ─────────────────────────────────────────────────── */}
            <Route element={<RequireRole role="admin" />}>
              <Route element={<AdminDashboard />}     path="/admin" />
              <Route element={<AdminWarehousesPage />} path="/admin/warehouses" />
              <Route element={<AdminCatalogPage />}   path="/admin/catalog" />
            </Route>

          </Route>

          {/* Warehouse status screens — no shell, standalone layout ──────── */}
          <Route element={<RequireRole role="warehouse" />}>
            <Route element={<WarehousePendingPage />}   path="/warehouse/pending" />
            <Route element={<WarehouseSuspendedPage />} path="/warehouse/suspended" />
          </Route>

        </Route>

      </Routes>
    </AuthProvider>
  )
}

export default App
