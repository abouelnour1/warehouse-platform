import { Ban, CheckCircle2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button, Card } from '../../components'
import { supabase } from '../../lib/supabase'
import { getAuthMessage } from '../auth/authService'
import { useAuth } from '../auth/useAuth'
import {
  cancelSubOrder,
  loadIncomingSubOrders,
  nextWarehouseStatus,
  statusLabels,
  updateSubOrderStatus,
  type IncomingSubOrder,
} from './orderService'

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ar-EG', { currency: 'EGP', style: 'currency' }).format(value)
}

export function WarehouseIncomingOrdersPage() {
  const { account } = useAuth()
  const warehouseId = account?.warehouse?.id ?? ''
  const [orders, setOrders] = useState<IncomingSubOrder[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadOrders = useCallback(async () => {
    if (!warehouseId) return
    setError('')
    setIsLoading(true)
    try {
      setOrders(await loadIncomingSubOrders(warehouseId))
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [warehouseId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOrders()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadOrders])

  useEffect(() => {
    const channel = supabase
      .channel(`warehouse-orders-${warehouseId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_orders' }, () => {
        void loadOrders()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadOrders, warehouseId])

  async function moveNext(order: IncomingSubOrder) {
    const next = nextWarehouseStatus(order.status)
    if (!next) return
    setBusyId(order.id)
    try {
      await updateSubOrderStatus(order.id, next)
      await loadOrders()
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function reject(order: IncomingSubOrder) {
    const reason = window.prompt('اكتب سبب الرفض') ?? ''
    setBusyId(order.id)
    try {
      await updateSubOrderStatus(order.id, 'rejected', reason)
      await loadOrders()
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(order: IncomingSubOrder) {
    const reason = window.prompt('اكتب سبب الإلغاء')
    if (!reason) return
    setBusyId(order.id)
    try {
      await cancelSubOrder(order.id, reason)
      await loadOrders()
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="dashboard-page orders-page">
      <div className="page-heading">
        <p className="eyebrow">طلبات واردة</p>
        <h1>طلبات المخزن</h1>
        <p>غيّر حالة الطلبات الفرعية وسيظهر التحديث لدى الصيدلية فوريا.</p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {isLoading ? <Card>جار تحميل الطلبات...</Card> : null}
      {!isLoading && orders.length === 0 ? <Card>لا توجد طلبات واردة.</Card> : null}

      <div className="orders-list">
        {orders.map((order) => {
          const next = nextWarehouseStatus(order.status)
          const canReject = order.status === 'pending'
          const canCancel = !['delivered', 'cancelled', 'rejected'].includes(order.status)

          return (
            <Card className="order-card" key={order.id}>
              <div className="order-head">
                <div>
                  <p className="eyebrow">{order.orderCode} | {order.subOrderCode}</p>
                  <h2>{statusLabels[order.status]}</h2>
                  <p>{formatMoney(order.subtotal)}</p>
                </div>
                <span className={`order-status status-${order.status}`}>{statusLabels[order.status]}</span>
              </div>

              <div className="order-items-mini">
                {order.items.map((item) => (
                  <div key={item.id}>
                    <strong>{item.productName}</strong>
                    <span>{item.quantity} x {formatMoney(item.unitPrice)}</span>
                  </div>
                ))}
              </div>

              <div className="row-actions">
                {next ? (
                  <Button disabled={busyId === order.id} onClick={() => void moveNext(order)} type="button">
                    <CheckCircle2 size={18} />
                    {statusLabels[next]}
                  </Button>
                ) : null}
                {canReject ? (
                  <Button disabled={busyId === order.id} onClick={() => void reject(order)} type="button" variant="secondary">
                    <XCircle size={18} />
                    رفض
                  </Button>
                ) : null}
                {canCancel ? (
                  <Button disabled={busyId === order.id} onClick={() => void cancel(order)} type="button" variant="ghost">
                    <Ban size={18} />
                    إلغاء
                  </Button>
                ) : null}
              </div>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
