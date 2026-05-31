import { supabase } from '../../lib/supabase'

export interface ImportSummary {
  autoCount: number
  reviewCount: number
  newCount: number
  skippedCount: number
  importBatchId: string
}

export interface ImportResult {
  summary: ImportSummary
  mapping: Record<string, number>
}

export interface ReviewQueueItem {
  id: string
  raw_name: string
  raw_price: number | null
  raw_stock: number | null
  match_score: number | null
  suggested_product_id: string | null
  products: {
    canonical_name: string
    product_code: string
  } | null
}

export interface WarehouseOffer {
  id: string
  warehouse_raw_name: string
  price: number
  stock: number
  discount_pct: number
  is_available: boolean
  products: {
    canonical_name: string
    product_code: string
  } | null
}

export async function importPriceFile(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)

  const { data, error } = await supabase.functions.invoke<ImportResult>('import-prices', {
    body: formData,
  })

  if (error) throw error
  if (!data) throw new Error('لم يتم إرجاع نتيجة من الخادم.')
  return data
}

export async function listPendingReviews(): Promise<ReviewQueueItem[]> {
  const { data, error } = await supabase
    .from('match_review_queue')
    .select('id, raw_name, raw_price, raw_stock, match_score, suggested_product_id, products:suggested_product_id(canonical_name, product_code)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .returns<ReviewQueueItem[]>()

  if (error) throw error
  return data ?? []
}

export async function resolveReview(reviewId: string, action: 'same' | 'new' | 'ignore', productId?: string): Promise<void> {
  const { error } = await supabase.functions.invoke('import-prices', {
    body: { action, reviewId, productId },
  })

  if (error) throw error
}

export async function listWarehouseOffers(): Promise<WarehouseOffer[]> {
  const { data, error } = await supabase
    .from('offers')
    .select('id, warehouse_raw_name, price, stock, discount_pct, is_available, products:product_id(canonical_name, product_code)')
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
    .returns<WarehouseOffer[]>()

  if (error) throw error
  return data ?? []
}

export async function updateWarehouseOffer(offerId: string, price: number, stock: number): Promise<void> {
  const { error } = await supabase
    .from('offers')
    .update({
      price,
      stock,
      is_available: stock > 0,
    })
    .eq('id', offerId)

  if (error) throw error
}

export async function manualAddOffer(rawName: string, price: number, stock: number, barcode: string): Promise<void> {
  const { error } = await supabase.functions.invoke('import-prices', {
    body: {
      action: 'manualAdd',
      rawName,
      price,
      stock,
      barcode,
    },
  })

  if (error) throw error
}
