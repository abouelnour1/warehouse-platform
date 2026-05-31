import { Ban, Clock3 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button, Card } from '../../components'
import { supabase } from '../../lib/supabase'
import { getAuthMessage } from '../auth/authService'
import { useAuth } from '../auth/useAuth'
import { cancelSubOrder, loadPharmacyOrders, statusLabels, type TrackedOrder } from './orderService'

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ar-EG', { currency: 'EGP', style: 'currency' }).format(value)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function PharmacyOrdersPage() {
  const { account } = useAuth()
  const pharmacyId = account?.pharmacy?.id ?? ''
  const [orders, setOrders] = useState<TrackedOrder[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const loadOrders = useCallback(async () => {
    if (!pharmacyId) return
    setError('')
    setIsLoading(true)
    try {
      setOrders(await loadPharmacyOrders(pharmacyId))
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [pharmacyId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOrders()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadOrders])

  useEffect(() => {
    const channel = supabase
      .channel(`pharmacy-orders-${pharmacyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_orders' }, () => {
        void loadOrders()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        void loadOrders()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadOrders, pharmacyId])

  async function handleCancel(subOrderId: string) {
    const reason = window.prompt('اكتب سبب الإلغاء')
    if (!reason) return

    try {
      await cancelSubOrder(subOrderId, reason)
      await loadOrders()
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  return (
    <section className="dashboard-page orders-page">
      <div className="page-heading">
        <p className="eyebrow">طلباتي</p>
        <h1>تتبع الطلبات</h1>
        <p>تابع حالة كل مخزن داخل الطلب الرئيسي بشكل فوري.</p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {isLoading ? <Card>جار تحميل الطلبات...</Card> : null}
      {!isLoading && orders.length === 0 ? <Card>لا توجد طلبات بعد.</Card> : null}

      <div className="orders-list">
        {orders.map((order) => (
          <Card className="order-card" key={order.id}>
            <div className="order-head">
              <div>
                <p className="eyebrow">{order.orderCode}</p>
                <h2>{statusLabels[order.status]}</h2>
                <p>{formatDate(order.createdAt)} | الإجمالي {formatMoney(order.totalAmount)}</p>
              </div>
              <span className={`order-status status-${order.status}`}>{statusLabels[order.status]}</span>
            </div>

            <div className="sub-order-track-list">
              {order.subOrders.map((subOrder) => {
                const canCancel = !['shipped', 'delivered', 'cancelled', 'rejected'].includes(subOrder.status)

                return (
                  <div className="sub-order-track" key={subOrder.id}>
                    <div>
                      <strong>{subOrder.warehouseName}</strong>
                      <p>{subOrder.subOrderCode} | {formatMoney(subOrder.subtotal)}</p>
                      {subOrder.cancelReason ? <p>سبب الإلغاء: {subOrder.cancelReason}</p> : null}
                    </div>
                    <span className={`order-status status-${subOrder.status}`}>
                      <Clock3 size={14} />
                      {statusLabels[subOrder.status]}
                    </span>
                    {canCancel ? (
                      <Button onClick={() => void handleCancel(subOrder.id)} type="button" variant="ghost">
                        <Ban size={16} />
                        إلغاء الجزء
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
