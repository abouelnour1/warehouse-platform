import { supabase } from '../../lib/supabase'
import type { OrderStatus } from '../orders/orderService'

interface NotificationOrderDetails {
  orderCode: string
  subOrderCode: string
  status: OrderStatus
}

export interface InAppNotification {
  id: string
  recipient_id: string
  actor_id: string | null
  entity_type: string
  entity_id: string
  message: string
  read_at: string | null
  created_at: string
  order: NotificationOrderDetails | null
}

type NotificationRow = Omit<InAppNotification, 'order'>

interface NotificationSubOrderRow {
  id: string
  sub_order_code: string
  status: OrderStatus
  orders: { order_code: string } | Array<{ order_code: string }> | null
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export async function loadNotifications(): Promise<InAppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, recipient_id, actor_id, entity_type, entity_id, message, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<NotificationRow[]>()

  if (error) throw error

  const notifications = data ?? []
  const subOrderIds = [...new Set(
    notifications
      .filter((notification) => notification.entity_type === 'sub_orders')
      .map((notification) => notification.entity_id),
  )]

  if (subOrderIds.length === 0) {
    return notifications.map((notification) => ({ ...notification, order: null }))
  }

  const { data: subOrders, error: subOrdersError } = await supabase
    .from('sub_orders')
    .select('id, sub_order_code, status, orders:parent_order_id(order_code)')
    .in('id', subOrderIds)
    .returns<NotificationSubOrderRow[]>()

  if (subOrdersError) throw subOrdersError

  const orderBySubOrderId = new Map(
    (subOrders ?? []).map((subOrder) => [
      subOrder.id,
      {
        orderCode: first(subOrder.orders)?.order_code ?? '-',
        subOrderCode: subOrder.sub_order_code,
        status: subOrder.status,
      },
    ]),
  )

  return notifications.map((notification) => ({
    ...notification,
    order: notification.entity_type === 'sub_orders'
      ? orderBySubOrderId.get(notification.entity_id) ?? null
      : null,
  }))
}

export async function loadUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)

  if (error) throw error
  return count ?? 0
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)

  if (error) throw error
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)

  if (error) throw error
}
