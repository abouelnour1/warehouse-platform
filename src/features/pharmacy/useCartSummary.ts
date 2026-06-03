import { useCallback, useEffect, useState } from 'react'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { lineTotal, loadCartItems } from './cartService'

export interface CartSummary {
  count: number   // total item quantity across all cart entries
  total: number   // grand total (price × qty × discount)
}

const EMPTY: CartSummary = { count: 0, total: 0 }

export function useCartSummary(): CartSummary {
  const { account, role } = useAuth()
  const pharmacyId = account?.pharmacy?.id ?? ''
  const [summary, setSummary] = useState<CartSummary>(EMPTY)

  const refresh = useCallback(async () => {
    if (!pharmacyId || role !== 'pharmacy') { setSummary(EMPTY); return }
    try {
      const items = await loadCartItems(pharmacyId)
      setSummary({
        count: items.reduce((sum, i) => sum + i.quantity, 0),
        total: items.reduce((sum, i) => sum + lineTotal(i), 0),
      })
    } catch {
      // badge failing shouldn't surface errors
    }
  }, [pharmacyId, role])

  useEffect(() => { void refresh() }, [refresh])

  // Keep badge in sync with realtime cart changes
  useEffect(() => {
    if (!pharmacyId) return
    const ch = supabase
      .channel('cart-badge-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cart_items' }, () => void refresh())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [pharmacyId, refresh])

  return summary
}
