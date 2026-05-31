import {
  Archive,
  Bell,
  BookOpen,
  Building2,
  ClipboardList,
  Home,
  LayoutDashboard,
  LogOut,
  Package,
  Search,
  ShoppingCart,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet } from 'react-router'

import { supabase } from '../../lib/supabase'
import type { UserRole, WarehouseStatus } from '../../types'
import { loadUnreadNotificationCount } from '../notifications/notificationService'
import { useAuth } from '../auth/useAuth'

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

interface TabDef {
  label: string
  path: string
  icon: ComponentType<{ size?: number }>
  end?: boolean
}

const PHARMACY_TABS: TabDef[] = [
  { label: 'البحث',  path: '/app',    icon: Search       },
  { label: 'السلة',  path: '/cart',   icon: ShoppingCart },
  { label: 'طلباتي', path: '/orders', icon: Package      },
  { label: 'حسابي',  path: '/profile', icon: UserRound   },
]

const WAREHOUSE_TABS: TabDef[] = [
  { label: 'الرئيسية', path: '/warehouse',          icon: Home,          end: true },
  { label: 'أصنافي',   path: '/warehouse/products', icon: Archive                 },
  { label: 'الطلبات',  path: '/warehouse/orders',   icon: ClipboardList           },
  { label: 'حسابي',    path: '/profile',             icon: UserRound               },
]

const ADMIN_TABS: TabDef[] = [
  { label: 'لوحة التحكم', path: '/admin',            icon: LayoutDashboard, end: true },
  { label: 'المخازن',     path: '/admin/warehouses', icon: Building2                  },
  { label: 'الكتالوج',    path: '/admin/catalog',    icon: BookOpen                   },
  { label: 'حسابي',       path: '/profile',           icon: UserRound                  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tabsForRole(role: UserRole | null): TabDef[] {
  if (role === 'pharmacy')  return PHARMACY_TABS
  if (role === 'warehouse') return WAREHOUSE_TABS
  if (role === 'admin')     return ADMIN_TABS
  return []
}

function roleLabel(role: UserRole | null, status: WarehouseStatus | null): string {
  if (role === 'pharmacy') return 'حساب صيدلية'
  if (role === 'admin')    return 'حساب أدمن'
  if (role === 'warehouse') {
    const s = status === 'active' ? 'نشط' : status === 'suspended' ? 'موقوف' : 'قيد المراجعة'
    return `حساب مخزن · ${s}`
  }
  return ''
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function AppShell() {
  const { role, warehouseStatus, profile, account, signOut } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)

  // Organisation name > personal name
  const displayName =
    account?.pharmacy?.pharmacy_name ??
    account?.warehouse?.warehouse_name ??
    profile?.full_name ??
    ''

  const tabs = tabsForRole(role)

  const refreshUnread = useCallback(async () => {
    try { setUnreadCount(await loadUnreadNotificationCount()) }
    catch { setUnreadCount(0) }
  }, [])

  // Initial load
  useEffect(() => {
    const id = window.setTimeout(() => void refreshUnread(), 0)
    return () => window.clearTimeout(id)
  }, [refreshUnread])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('shell-notif-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        void refreshUnread()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [refreshUnread])

  return (
    <div className="shell">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="shell-header">
        <div className="shell-identity">
          <span className="shell-name">{displayName}</span>
          <span className="shell-role">{roleLabel(role, warehouseStatus)}</span>
        </div>

        <div className="shell-actions">
          <NavLink aria-label="التنبيهات" className="shell-bell" to="/notifications">
            <Bell size={22} />
            {unreadCount > 0 && (
              <span className="shell-bell-count" aria-label={`${unreadCount} تنبيه غير مقروء`}>
                {unreadCount}
              </span>
            )}
          </NavLink>

          <button
            aria-label="تسجيل الخروج"
            className="shell-bell"
            onClick={() => void signOut()}
            type="button"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* ── Page content ────────────────────────────────────────── */}
      <main className="shell-content">
        <Outlet />
      </main>

      {/* ── Bottom tab bar ──────────────────────────────────────── */}
      <nav aria-label="التنقل الرئيسي" className="bottom-tabs">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            className={({ isActive }) => `tab-btn${isActive ? ' active' : ''}`}
            end={tab.end}
            to={tab.path}
          >
            <tab.icon size={22} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
