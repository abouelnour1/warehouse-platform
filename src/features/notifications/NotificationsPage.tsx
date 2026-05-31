import { Bell, CheckCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button, Card } from '../../components'
import { supabase } from '../../lib/supabase'
import { getAuthMessage } from '../auth/authService'
import { statusLabels } from '../orders/orderService'
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type InAppNotification,
} from './notificationService'

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function NotificationsPage() {
  const [items, setItems] = useState<InAppNotification[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    setError('')
    setIsLoading(true)
    try {
      setItems(await loadNotifications())
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [refresh])

  useEffect(() => {
    const channel = supabase
      .channel('in-app-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        void refresh()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  async function handleRead(notificationId: string) {
    try {
      await markNotificationRead(notificationId)
      await refresh()
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  async function handleReadAll() {
    try {
      await markAllNotificationsRead()
      await refresh()
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  return (
    <section className="dashboard-page notifications-page">
      <div className="page-heading">
        <p className="eyebrow">التنبيهات</p>
        <h1>مركز التنبيهات</h1>
        <p>تنبيهات داخل التطبيق للطلبات وتغيرات الحالة. تم تجهيز قاعدة البيانات لاحقا لتخزين رموز Push عبر Capacitor.</p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="actions-row">
        <Button onClick={() => void handleReadAll()} type="button" variant="secondary">
          <CheckCheck size={18} />
          تعليم الكل كمقروء
        </Button>
      </div>

      {isLoading ? <Card>جار تحميل التنبيهات...</Card> : null}
      {!isLoading && items.length === 0 ? (
        <Card className="empty-state">
          <Bell size={28} />
          <h2>لا توجد تنبيهات</h2>
          <p>ستظهر تنبيهات الطلبات هنا عند وصولها.</p>
        </Card>
      ) : null}

      <div className="notifications-list">
        {items.map((item) => (
          <Card className={item.read_at ? 'notification-row' : 'notification-row unread'} key={item.id}>
            <div>
              {item.order ? (
                <>
                  <strong>{item.order.orderCode} | {item.order.subOrderCode}</strong>
                  <p>{item.message}</p>
                </>
              ) : (
                <strong>{item.message}</strong>
              )}
              <p>{formatDate(item.created_at)}</p>
            </div>
            {item.order ? (
              <div className="notification-actions">
                <span className={`order-status status-${item.order.status}`}>
                  {statusLabels[item.order.status]}
                </span>
                {!item.read_at ? (
                  <Button onClick={() => void handleRead(item.id)} type="button" variant="ghost">
                    تم
                  </Button>
                ) : null}
              </div>
            ) : item.read_at ? (
              <span className="status-pill">مقروء</span>
            ) : (
              <Button onClick={() => void handleRead(item.id)} type="button" variant="ghost">
                تم
              </Button>
            )}
          </Card>
        ))}
      </div>
    </section>
  )
}
