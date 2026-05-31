import { supabase } from '../../lib/supabase'

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'rejected'
  | 'partial'
  | 'completed'

export interface OrderItemSnapshot {
  id: string
  productName: string
  warehouseName: string
  unitPrice: number
  discountPct: number
  quantity: number
  lineTotal: number
}

export interface TrackedSubOrder {
  id: string
  subOrderCode: string
  warehouseName: string
  status: OrderStatus
  subtotal: number
  cancelReason: string | null
  updatedAt: string
  items: OrderItemSnapshot[]
}

export interface TrackedOrder {
  id: string
  orderCode: string
  status: OrderStatus
  totalAmount: number
  createdAt: string
  subOrders: TrackedSubOrder[]
}

export interface IncomingSubOrder extends TrackedSubOrder {
  parentOrderId: string
  orderCode: string
  orderCreatedAt: string
}

interface OrderRow {
  id: string
  order_code: string
  status: OrderStatus
  total_amount: number
  created_at: string
  sub_orders: SubOrderRow[] | null
}

interface SubOrderRow {
  id: string
  sub_order_code: string
  parent_order_id: string
  status: OrderStatus
  subtotal: number
  cancel_reason: string | null
  updated_at: string
  warehouses: { warehouse_name: string } | Array<{ warehouse_name: string }> | null
  order_items: OrderItemRow[] | null
  orders?: { order_code: string; created_at: string } | Array<{ order_code: string; created_at: string }> | null
}

interface OrderItemRow {
  id: string
  product_name: string
  warehouse_name: string
  unit_price: number
  discount_pct: number
  quantity: number
  line_total: number
}

export const statusLabels: Record<OrderStatus, string> = {
  pending: 'بانتظار القبول',
  accepted: 'تم القبول',
  preparing: 'قيد التحضير',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
  rejected: 'مرفوض',
  partial: 'جزئي',
  completed: 'مكتمل',
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function mapItems(rows: OrderItemRow[] | null): OrderItemSnapshot[] {
  return (rows ?? []).map((item) => ({
    id: item.id,
    productName: item.product_name,
    warehouseName: item.warehouse_name,
    unitPrice: item.unit_price,
    discountPct: item.discount_pct,
    quantity: item.quantity,
    lineTotal: item.line_total,
  }))
}

function mapSubOrder(row: SubOrderRow): TrackedSubOrder {
  return {
    id: row.id,
    subOrderCode: row.sub_order_code,
    warehouseName: first(row.warehouses)?.warehouse_name ?? 'مخزن',
    status: row.status,
    subtotal: row.subtotal,
    cancelReason: row.cancel_reason,
    updatedAt: row.updated_at,
    items: mapItems(row.order_items),
  }
}

export async function loadPharmacyOrders(pharmacyId: string): Promise<TrackedOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      order_code,
      status,
      total_amount,
      created_at,
      sub_orders(
        id,
        sub_order_code,
        parent_order_id,
        status,
        subtotal,
        cancel_reason,
        updated_at,
        warehouses:warehouse_id(warehouse_name),
        order_items(id, product_name, warehouse_name, unit_price, discount_pct, quantity, line_total)
      )
    `)
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .returns<OrderRow[]>()

  if (error) throw error

  return (data ?? []).map((order) => ({
    id: order.id,
    orderCode: order.order_code,
    status: order.status,
    totalAmount: order.total_amount,
    createdAt: order.created_at,
    subOrders: (order.sub_orders ?? []).map(mapSubOrder),
  }))
}

export async function loadIncomingSubOrders(warehouseId: string): Promise<IncomingSubOrder[]> {
  const { data, error } = await supabase
    .from('sub_orders')
    .select(`
      id,
      sub_order_code,
      parent_order_id,
      status,
      subtotal,
      cancel_reason,
      updated_at,
      warehouses:warehouse_id(warehouse_name),
      orders:parent_order_id(order_code, created_at),
      order_items(id, product_name, warehouse_name, unit_price, discount_pct, quantity, line_total)
    `)
    .eq('warehouse_id', warehouseId)
    .order('updated_at', { ascending: false })
    .returns<SubOrderRow[]>()

  if (error) throw error

  return (data ?? []).map((row) => {
    const base = mapSubOrder(row)
    const order = first(row.orders)
    return {
      ...base,
      parentOrderId: row.parent_order_id,
      orderCode: order?.order_code ?? '-',
      orderCreatedAt: order?.created_at ?? row.updated_at,
    }
  })
}

export async function updateSubOrderStatus(subOrderId: string, status: OrderStatus, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('update_sub_order_status', {
    p_sub_order_id: subOrderId,
    p_status: status,
    p_reason: reason ?? null,
  })

  if (error) throw error
}

export async function cancelSubOrder(subOrderId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_sub_order', {
    p_sub_order_id: subOrderId,
    p_reason: reason,
  })

  if (error) throw error
}

export function nextWarehouseStatus(status: OrderStatus): OrderStatus | null {
  if (status === 'pending') return 'accepted'
  if (status === 'accepted') return 'preparing'
  if (status === 'preparing') return 'shipped'
  if (status === 'shipped') return 'delivered'
  return null
}
