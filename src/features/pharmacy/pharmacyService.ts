import { supabase } from '../../lib/supabase'
import type { ProductResult } from './searchProvider'

export async function addOfferToCart(pharmacyId: string, offerId: string, quantity: number): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from('cart_items')
    .select('id, quantity')
    .eq('pharmacy_id', pharmacyId)
    .eq('offer_id', offerId)
    .maybeSingle<{ id: string; quantity: number }>()

  if (readError) throw readError

  if (existing) {
    const { error } = await supabase
      .from('cart_items')
      .update({ quantity: existing.quantity + quantity })
      .eq('id', existing.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('cart_items').insert({
    pharmacy_id: pharmacyId,
    offer_id: offerId,
    quantity,
  })
  if (error) throw error
}

export async function addProductToQuickList(pharmacyId: string, productId: string): Promise<void> {
  const { error } = await supabase
    .from('quick_list')
    .upsert({ pharmacy_id: pharmacyId, product_id: productId }, { onConflict: 'pharmacy_id,product_id' })

  if (error) throw error
}

export async function removeProductFromQuickList(pharmacyId: string, productId: string): Promise<void> {
  const { error } = await supabase
    .from('quick_list')
    .delete()
    .eq('pharmacy_id', pharmacyId)
    .eq('product_id', productId)

  if (error) throw error
}

export async function loadQuickListProductIds(pharmacyId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('quick_list').select('product_id').eq('pharmacy_id', pharmacyId)
  if (error) throw error
  return new Set((data ?? []).map((row) => row.product_id as string))
}

export async function loadQuickListProducts(pharmacyId: string): Promise<ProductResult[]> {
  const { data, error } = await supabase
    .from('quick_list')
    .select('products:product_id(id, product_code, canonical_name, normalized_key, brand, strength, form, pack_size)')
    .eq('pharmacy_id', pharmacyId)

  if (error) throw error

  interface QuickListProductRow {
    products:
      | {
          id: string
          product_code: string
          canonical_name: string
          normalized_key: string
          brand: string | null
          strength: string | null
          form: string | null
          pack_size: string | null
        }
      | Array<{
          id: string
          product_code: string
          canonical_name: string
          normalized_key: string
          brand: string | null
          strength: string | null
          form: string | null
          pack_size: string | null
        }>
      | null
  }

  return ((data ?? []) as QuickListProductRow[]).flatMap((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products

    if (!product) return []
    return {
      id: product.id,
      productCode: product.product_code,
      canonicalName: product.canonical_name,
      normalizedKey: product.normalized_key,
      brand: product.brand,
      strength: product.strength,
      form: product.form,
      packSize: product.pack_size,
      offers: [],
    }
  })
}
