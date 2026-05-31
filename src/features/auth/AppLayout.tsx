import { Bell, LogOut, UserRound } from 'lucide-react'
import { Link, Outlet, useNavigate } from 'react-router'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '../../components'
import { supabase } from '../../lib/supabase'
import { getAuthMessage, signOut } from './authService'
import { useAuth } from './useAuth'
import { loadUnreadNotificationCount } from '../notifications/notificationService'

export function AppLayout() {
  const { account } = useAuth()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)

  const refreshUnreadCount = useCallback(async () => {
    try {
      setUnreadCount(await loadUnreadNotificationCount())
    } catch {
      setUnreadCount(0)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshUnreadCount()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [refreshUnreadCount])

  useEffect(() => {
    const channel = supabase
      .channel('topbar-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        void refreshUnreadCount()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refreshUnreadCount])

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/signin', { replace: true })
    } catch (error) {
      window.alert(getAuthMessage(error))
    }
  }

  return (
    <main className="app-shell dashboard-shell">
      <header className="topbar">
        <Link className="topbar-brand" to="/redirect">
          منصة الصيدليات
        </Link>
        <nav className="topbar-actions" aria-label="روابط الحساب">
          {account?.profile.role === 'warehouse' && account.warehouse?.status === 'active' ? (
            <>
              <Link className="icon-link" to="/warehouse/import">رفع الأسعار</Link>
              <Link className="icon-link" to="/warehouse/orders">الطلبات</Link>
              <Link className="icon-link" to="/warehouse/reviews">المراجعة</Link>
              <Link className="icon-link" to="/warehouse/products">منتجاتي</Link>
            </>
          ) : null}
          {account?.profile.role === 'pharmacy' ? (
            <>
              <Link className="icon-link" to="/app">البحث</Link>
              <Link className="icon-link" to="/cart">السلة</Link>
              <Link className="icon-link" to="/orders">طلباتي</Link>
            </>
          ) : null}
          {account?.profile.role === 'admin' ? (
            <Link className="icon-link" to="/admin">الإدارة</Link>
          ) : null}
          <Link className="icon-link notification-link" to="/notifications">
            <Bell size={18} />
            التنبيهات
            {unreadCount > 0 ? <span className="notification-count">{unreadCount}</span> : null}
          </Link>
          <Link className="icon-link" to="/profile">
            <UserRound size={18} />
            {account?.profile.full_name ?? 'الملف الشخصي'}
          </Link>
          <Button onClick={handleSignOut} type="button" variant="ghost">
            <LogOut size={18} />
            خروج
          </Button>
        </nav>
      </header>
      <Outlet />
    </main>
  )
}
