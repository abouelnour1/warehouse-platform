import { supabase } from '../../lib/supabase'

export interface PendingWarehouse {
  id: string
  warehouse_name: string
  status: string
  min_order_value: number
  delivery_areas: string[]
  profiles: {
    full_name: string
    phone: string | null
  } | null
}

export interface CommissionConfigRow {
  id: string
  warehouse_id: string | null
  commission_pct: number
  active: boolean
  warehouses: {
    warehouse_name: string
  } | null
}

export interface AdminWarehouseOption {
  id: string
  warehouse_name: string
  status: string
}

export interface AdminProduct {
  id: string
  product_code: string
  canonical_name: string
  normalized_key: string
  is_verified: boolean
  is_deleted: boolean
}

export interface MatchMetricRow {
  id: string
  warehouse_id: string
  import_batch_id: string
  auto_count: number
  review_count: number
  new_count: number
  corrected_count: number
  created_at: string
  warehouses: {
    warehouse_name: string
  } | null
}

export interface AdminStats {
  active_warehouses: number
  orders_count: number
  total_commission_due: number
}

export async function loadPendingWarehouses(): Promise<PendingWarehouse[]> {
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, warehouse_name, status, min_order_value, delivery_areas, profiles:id(full_name, phone)')
    .eq('status', 'pending')
    .eq('is_deleted', false)
    .order('warehouse_name')
    .returns<PendingWarehouse[]>()

  if (error) throw error
  return data ?? []
}

export async function setWarehouseStatus(warehouseId: string, status: 'active' | 'suspended'): Promise<void> {
  const { error } = await supabase.rpc('admin_set_warehouse_status', {
    p_warehouse_id: warehouseId,
    p_status: status,
  })

  if (error) throw error
}

export async function loadCommissionConfig(): Promise<CommissionConfigRow[]> {
  const { data, error } = await supabase
    .from('commission_config')
    .select('id, warehouse_id, commission_pct, active, warehouses:warehouse_id(warehouse_name)')
    .eq('active', true)
    .order('warehouse_id', { ascending: true, nullsFirst: true })
    .returns<CommissionConfigRow[]>()

  if (error) throw error
  return data ?? []
}

export async function setCommissionRate(warehouseId: string | null, commissionPct: number): Promise<void> {
  const { error } = await supabase.rpc('admin_set_commission_rate', {
    p_warehouse_id: warehouseId,
    p_commission_pct: commissionPct,
  })

  if (error) throw error
}

export async function loadWarehouseOptions(): Promise<AdminWarehouseOption[]> {
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, warehouse_name, status')
    .eq('is_deleted', false)
    .order('warehouse_name')
    .returns<AdminWarehouseOption[]>()

  if (error) throw error
  return data ?? []
}

export async function loadProducts(): Promise<AdminProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, product_code, canonical_name, normalized_key, is_verified, is_deleted')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<AdminProduct[]>()

  if (error) throw error
  return data ?? []
}

export async function updateProduct(productId: string, productCode: string, isVerified: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_update_product', {
    p_product_id: productId,
    p_product_code: productCode,
    p_is_verified: isVerified,
  })

  if (error) throw error
}

export async function mergeProducts(sourceProductId: string, targetProductId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_merge_products', {
    p_source_product_id: sourceProductId,
    p_target_product_id: targetProductId,
  })

  if (error) throw error
}

export async function loadMatchMetrics(): Promise<MatchMetricRow[]> {
  const { data, error } = await supabase
    .from('match_metrics')
    .select('id, warehouse_id, import_batch_id, auto_count, review_count, new_count, corrected_count, created_at, warehouses:warehouse_id(warehouse_name)')
    .order('created_at', { ascending: false })
    .limit(30)
    .returns<MatchMetricRow[]>()

  if (error) throw error
  return data ?? []
}

export async function loadAdminStats(): Promise<AdminStats> {
  const { data, error } = await supabase.rpc('admin_dashboard_stats')
  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  return {
    active_warehouses: Number(row?.active_warehouses ?? 0),
    orders_count: Number(row?.orders_count ?? 0),
    total_commission_due: Number(row?.total_commission_due ?? 0),
  }
}
