import { Navigate, Outlet } from 'react-router'

import type { UserRole, WarehouseStatus } from '../../types'
import { useAuth } from './useAuth'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getHomeRoute(role: UserRole | null, warehouseStatus: WarehouseStatus | null): string {
  switch (role) {
    case 'pharmacy': return '/app'
    case 'admin':    return '/admin'
    case 'warehouse':
      if (warehouseStatus === 'active')    return '/warehouse'
      if (warehouseStatus === 'suspended') return '/warehouse/suspended'
      return '/warehouse/pending'
    default:
      return '/signin'
  }
}

function LoadingScreen() {
  return (
    <main aria-busy="true" className="app-shell loading-screen">
      <p>جار التحميل…</p>
    </main>
  )
}

// ---------------------------------------------------------------------------
// RoleRedirect — mounted at "/" and the catch-all "*"
// Shows a splash while the session resolves, then sends each user to their
// correct home route.
// ---------------------------------------------------------------------------

export function RoleRedirect() {
  const { session, role, warehouseStatus, loading, error } = useAuth()

  // DIAG-3: shows what state RoleRedirect sees on every render
  console.log('[redirect] RoleRedirect render — loading=', loading, 'hasSession=', !!session, 'role=', role, 'error=', error)

  if (loading) return <LoadingScreen />
  if (error || !session || !role) return <Navigate replace to="/signin" />

  return <Navigate replace to={getHomeRoute(role, warehouseStatus)} />
}

// ---------------------------------------------------------------------------
// RequireAuth — outermost protection layer
// Shows a splash only during the initial auth check (profile === null while
// loading), so background refreshes don't flash the whole screen.
// ---------------------------------------------------------------------------

export function RequireAuth() {
  const { session, profile, loading } = useAuth()

  if (loading && profile === null) return <LoadingScreen />
  if (!session || !profile) return <Navigate replace to="/signin" />

  return <Outlet />
}

// ---------------------------------------------------------------------------
// RequireRole — wraps a role's route group
// Any other authenticated role is redirected to their own home; if no role is
// resolved yet, falls back to /signin.
// ---------------------------------------------------------------------------

export function RequireRole({ role }: { role: UserRole }) {
  const { role: userRole, warehouseStatus, profile, loading } = useAuth()

  if (loading && profile === null) return <LoadingScreen />
  if (userRole !== role) return <Navigate replace to={getHomeRoute(userRole, warehouseStatus)} />

  return <Outlet />
}

// ---------------------------------------------------------------------------
// RequireActiveWarehouse — inner guard for the main warehouse dashboard
// Pending and suspended warehouses are redirected to their status screen
// instead of seeing an empty/broken dashboard.
// ---------------------------------------------------------------------------

export function RequireActiveWarehouse() {
  const { warehouseStatus } = useAuth()

  if (warehouseStatus === 'suspended') return <Navigate replace to="/warehouse/suspended" />
  // null means the warehouse row is missing (edge case: failed signup).
  // Treat it the same as pending rather than letting the dashboard render with no data.
  if (warehouseStatus !== 'active') return <Navigate replace to="/warehouse/pending" />

  return <Outlet />
}
