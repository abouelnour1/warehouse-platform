import { supabase } from '../../lib/supabase'
import { parseName } from '../../lib/matching'

export interface ProductOffer {
  id: string
  productId: string
  warehouseId: string
  warehouseName: string
  warehouseRawName: string
  price: number
  discountPct: number
  stock: number
  isAvailable: boolean
  updatedAt: string
  warehouseLastPriceUpdate: string | null
}

export interface ProductResult {
  id: string
  productCode: string
  canonicalName: string
  normalizedKey: string
  brand: string | null
  strength: string | null
  form: string | null
  packSize: string | null
  offers: ProductOffer[]
}

export interface SearchProvider {
  search(query: string): Promise<ProductResult[]>
  loadOffers(productIds: string[]): Promise<Record<string, ProductOffer[]>>
}

interface SearchProductRow {
  id: string
  product_code: string
  canonical_name: string
  normalized_key: string
  brand: string | null
  strength: string | null
  form: string | null
  pack_size: string | null
}

interface OfferRow {
  id: string
  product_id: string
  warehouse_id: string
  warehouse_raw_name: string
  price: number
  discount_pct: number
  stock: number
  is_available: boolean
  updated_at: string
  warehouses: {
    warehouse_name: string
    last_price_update: string | null
  } | null
}

function sortOffers(offers: ProductOffer[]): ProductOffer[] {
  return [...offers].sort((a, b) => {
    if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1
    return effectivePrice(a) - effectivePrice(b)
  })
}

export function effectivePrice(offer: ProductOffer): number {
  return offer.price * (1 - offer.discountPct / 100)
}

export class SupabaseSearchProvider implements SearchProvider {
  async search(query: string): Promise<ProductResult[]> {
    const trimmed = query.trim()
    if (trimmed.length < 2) return []

    const parsed = parseName(trimmed)
    const searchText = [trimmed, parsed.normalizedKey, parsed.base].filter(Boolean).join(' ')

    const { data, error } = await supabase.rpc('search_products', {
      search_query: searchText,
      result_limit: 40,
    })

    if (error) throw error

    const products = (data ?? []) as SearchProductRow[]
    const offerMap = await this.loadOffers(products.map((product) => product.id))

    return products.map((product) => ({
      id: product.id,
      productCode: product.product_code,
      canonicalName: product.canonical_name,
      normalizedKey: product.normalized_key,
      brand: product.brand,
      strength: product.strength,
      form: product.form,
      packSize: product.pack_size,
      offers: offerMap[product.id] ?? [],
    }))
  }

  async loadOffers(productIds: string[]): Promise<Record<string, ProductOffer[]>> {
    if (productIds.length === 0) return {}

    const { data, error } = await supabase
      .from('offers')
      .select('id, product_id, warehouse_id, warehouse_raw_name, price, discount_pct, stock, is_available, updated_at, warehouses:warehouses!offers_warehouse_id_fkey(warehouse_name, last_price_update)')
      .in('product_id', productIds)
      .eq('is_deleted', false)
      .returns<OfferRow[]>()

    if (error) throw error

    return (data ?? []).reduce<Record<string, ProductOffer[]>>((acc, row) => {
      const offer: ProductOffer = {
        id: row.id,
        productId: row.product_id,
        warehouseId: row.warehouse_id,
        warehouseName: row.warehouses?.warehouse_name ?? 'مخزن',
        warehouseRawName: row.warehouse_raw_name,
        price: row.price,
        discountPct: row.discount_pct,
        stock: row.stock,
        isAvailable: row.is_available && row.stock > 0,
        updatedAt: row.updated_at,
        warehouseLastPriceUpdate: row.warehouses?.last_price_update ?? null,
      }
      acc[offer.productId] = sortOffers([...(acc[offer.productId] ?? []), offer])
      return acc
    }, {})
  }
}

export const searchProvider: SearchProvider = new SupabaseSearchProvider()
