import { supabase } from '../../lib/supabase'

export interface CartItem {
  id: string
  quantity: number
  offerId: string
  productName: string
  warehouseRawName: string
  warehouseId: string
  warehouseName: string
  minOrderValue: number
  price: number
  discountPct: number
  stock: number
  isAvailable: boolean
}

interface CartItemRow {
  id: string
  quantity: number
  offers:
    | {
        id: string
        warehouse_raw_name: string
        price: number
        discount_pct: number
        stock: number
        is_available: boolean
        products: { canonical_name: string } | Array<{ canonical_name: string }> | null
        warehouses:
          | {
              id: string
              warehouse_name: string
              min_order_value: number
            }
          | Array<{
              id: string
              warehouse_name: string
              min_order_value: number
            }>
          | null
      }
    | Array<{
        id: string
        warehouse_raw_name: string
        price: number
        discount_pct: number
        stock: number
        is_available: boolean
        products: { canonical_name: string } | Array<{ canonical_name: string }> | null
        warehouses:
          | {
              id: string
              warehouse_name: string
              min_order_value: number
            }
          | Array<{
              id: string
              warehouse_name: string
              min_order_value: number
            }>
          | null
      }>
    | null
}

export interface CartWarehouseGroup {
  warehouseId: string
  warehouseName: string
  minOrderValue: number
  subtotal: number
  items: CartItem[]
}

export function lineTotal(item: CartItem): number {
  return item.quantity * item.price * (1 - item.discountPct / 100)
}

export function groupCartItems(items: CartItem[]): CartWarehouseGroup[] {
  const groups = new Map<string, CartWarehouseGroup>()

  items.forEach((item) => {
    const existing = groups.get(item.warehouseId) ?? {
      warehouseId: item.warehouseId,
      warehouseName: item.warehouseName,
      minOrderValue: item.minOrderValue,
      subtotal: 0,
      items: [],
    }

    existing.items.push(item)
    existing.subtotal += lineTotal(item)
    groups.set(item.warehouseId, existing)
  })

  return [...groups.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'ar'))
}

export async function loadCartItems(pharmacyId: string): Promise<CartItem[]> {
  const { data, error } = await supabase
    .from('cart_items')
    .select(`
      id,
      quantity,
      offers:offer_id(
        id,
        warehouse_raw_name,
        price,
        discount_pct,
        stock,
        is_available,
        products:product_id(canonical_name),
        warehouses:warehouse_id(id, warehouse_name, min_order_value)
      )
    `)
    .eq('pharmacy_id', pharmacyId)

  if (error) throw error

  return ((data ?? []) as CartItemRow[]).flatMap((row) => {
    const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers
    const product = Array.isArray(offer?.products) ? offer.products[0] : offer?.products
    const warehouse = Array.isArray(offer?.warehouses) ? offer.warehouses[0] : offer?.warehouses

    if (!offer || !warehouse) return []

    return {
      id: row.id,
      quantity: row.quantity,
      offerId: offer.id,
      productName: product?.canonical_name ?? offer.warehouse_raw_name,
      warehouseRawName: offer.warehouse_raw_name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.warehouse_name,
      minOrderValue: warehouse.min_order_value,
      price: offer.price,
      discountPct: offer.discount_pct,
      stock: offer.stock,
      isAvailable: offer.is_available && offer.stock > 0,
    }
  })
}

export async function updateCartQuantity(itemId: string, quantity: number): Promise<void> {
  if (quantity <= 0) {
    await removeCartItem(itemId)
    return
  }

  const { error } = await supabase.from('cart_items').update({ quantity }).eq('id', itemId)
  if (error) throw error
}

export async function removeCartItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('cart_items').delete().eq('id', itemId)
  if (error) throw error
}

export interface ConfirmedOrder {
  id: string
  orderCode: string
}

export async function confirmCartOrder(): Promise<ConfirmedOrder> {
  const { data, error } = await supabase.rpc('create_order_from_cart')
  if (error) throw error

  const orderId = data as string
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_code')
    .eq('id', orderId)
    .single<{ id: string; order_code: string }>()

  if (orderError) throw orderError

  return { id: order.id, orderCode: order.order_code }
}
