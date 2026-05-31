import { useVirtualizer } from '@tanstack/react-virtual'
import { Clock3, Eye, PackagePlus, Search, ShoppingCart, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, Card } from '../../components'
import { supabase } from '../../lib/supabase'
import { getAuthMessage } from '../auth/authService'
import { useAuth } from '../auth/useAuth'
import {
  addOfferToCart,
  addProductToQuickList,
  loadQuickListProductIds,
  loadQuickListProducts,
  removeProductFromQuickList,
} from './pharmacyService'
import { effectivePrice, searchProvider, type ProductOffer, type ProductResult } from './searchProvider'

type QuantityDrafts = Record<string, number>

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: 'currency',
    currency: 'EGP',
  }).format(value)
}

function freshnessLabel(lastUpdate: string | null): { text: string; stale: boolean } {
  if (!lastUpdate) return { text: 'غير معروف', stale: true }

  const diffMs = Date.now() - new Date(lastUpdate).getTime()
  const hours = Math.max(0, Math.floor(diffMs / 3_600_000))
  if (hours < 1) return { text: 'محدث الآن', stale: false }
  if (hours < 24) return { text: `منذ ${hours} ساعة`, stale: false }

  const days = Math.floor(hours / 24)
  return { text: `منذ ${days} يوم`, stale: days >= 3 }
}

export function PharmacyDashboard() {
  const { account } = useAuth()
  const pharmacyId = account?.pharmacy?.id ?? ''
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductResult[]>([])
  const [quickProducts, setQuickProducts] = useState<ProductResult[]>([])
  const [quickIds, setQuickIds] = useState<Set<string>>(new Set())
  const [openedQuickProductId, setOpenedQuickProductId] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<QuantityDrafts>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const parentRef = useRef<HTMLDivElement | null>(null)

  const visibleProducts = query.trim().length >= 2
    ? results
    : openedQuickProductId
      ? quickProducts.filter((product) => product.id === openedQuickProductId)
      : quickProducts
  const productIds = useMemo(() => visibleProducts.map((product) => product.id), [visibleProducts])

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: visibleProducts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 280,
    overscan: 4,
  })

  const refreshOffers = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return

    const offerMap = await searchProvider.loadOffers(ids)
    const applyOffers = (current: ProductResult[]) =>
      current.map((product) => ({
        ...product,
        offers: offerMap[product.id] ?? product.offers,
      }))

    setResults(applyOffers)
    setQuickProducts(applyOffers)
  }, [])

  const loadQuickList = useCallback(async () => {
    if (!pharmacyId) return

    const [ids, products] = await Promise.all([
      loadQuickListProductIds(pharmacyId),
      loadQuickListProducts(pharmacyId),
    ])
    const offerMap = await searchProvider.loadOffers(products.map((product) => product.id))
    setQuickIds(ids)
    setQuickProducts(products.map((product) => ({ ...product, offers: offerMap[product.id] ?? [] })))
  }, [pharmacyId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadQuickList().catch((err) => setError(getAuthMessage(err)))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadQuickList])

  useEffect(() => {
    const trimmed = query.trim()
    const timeoutId = window.setTimeout(() => {
      if (trimmed.length < 2) {
        setResults([])
        setIsSearching(false)
        return
      }

      setIsSearching(true)
      setError('')
      void searchProvider
        .search(trimmed)
        .then(setResults)
        .catch((err) => setError(getAuthMessage(err)))
        .finally(() => setIsSearching(false))
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [query])

  useEffect(() => {
    const channel = supabase
      .channel('pharmacy-offers-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'offers' },
        () => {
          void refreshOffers(productIds).catch((err) => setError(getAuthMessage(err)))
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [productIds, refreshOffers])

  async function handleAddToCart(offer: ProductOffer) {
    if (!pharmacyId) return
    setError('')
    setMessage('')

    try {
      await addOfferToCart(pharmacyId, offer.id, quantities[offer.id] ?? 1)
      setMessage('تمت إضافة العرض إلى السلة.')
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  async function toggleQuickList(product: ProductResult) {
    if (!pharmacyId) return
    setError('')
    setMessage('')

    try {
      if (quickIds.has(product.id)) {
        await removeProductFromQuickList(pharmacyId, product.id)
        setQuickIds((current) => {
          const next = new Set(current)
          next.delete(product.id)
          return next
        })
        setQuickProducts((current) => current.filter((item) => item.id !== product.id))
        setOpenedQuickProductId((current) => current === product.id ? null : current)
      } else {
        await addProductToQuickList(pharmacyId, product.id)
        setQuickIds((current) => new Set(current).add(product.id))
        setMessage('تمت إضافة الصنف إلى القائمة السريعة.')
      }
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  async function openQuickListProduct(productId: string) {
    setError('')
    setMessage('')

    try {
      const offerMap = await searchProvider.loadOffers([productId])
      setQuickProducts((current) =>
        current.map((product) => product.id === productId
          ? { ...product, offers: offerMap[product.id] ?? [] }
          : product))
      setOpenedQuickProductId(productId)
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  async function addQuickListToCart() {
    if (!pharmacyId) return
    setError('')
    setMessage('')

    try {
      const bestOffers = quickProducts.flatMap((product) => product.offers.find((offer) => offer.isAvailable) ?? [])
      await Promise.all(bestOffers.map((offer) => addOfferToCart(pharmacyId, offer.id, 1)))
      setMessage(`تمت إضافة ${bestOffers.length} عرض من القائمة السريعة إلى السلة.`)
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  return (
    <section className="dashboard-page search-page">
      <div className="page-heading">
        <p className="eyebrow">البحث والمقارنة</p>
        <h1>{account?.pharmacy?.pharmacy_name ?? 'صيدليتي'}</h1>
        <p>ابحث عن الصنف وشاهد عروض المخازن مرتبة من الأرخص إلى الأعلى مع تحديث فوري للأسعار.</p>
      </div>

      <Card className="search-panel">
        <div className="search-box">
          <Search size={22} />
          <input
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث باسم الصنف، التركيز، أو الكود"
            value={query}
          />
        </div>
        <div className="quick-list-bar">
          <div>
            <strong>قائمتي السريعة</strong>
            <p>{quickProducts.length} صنف محفوظ</p>
          </div>
          <Button disabled={quickProducts.length === 0} onClick={() => void addQuickListToCart()} type="button" variant="secondary">
            <PackagePlus size={18} />
            أضف الكل للسلة
          </Button>
        </div>
        {quickProducts.length > 0 ? (
          <div className="quick-list-items">
            <Button onClick={() => setOpenedQuickProductId(null)} type="button" variant="ghost">
              عرض الكل
            </Button>
            {quickProducts.map((product) => (
              <Button key={product.id} onClick={() => void openQuickListProduct(product.id)} type="button" variant="ghost">
                <Eye size={16} />
                {product.canonicalName}
              </Button>
            ))}
          </div>
        ) : null}
      </Card>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {isSearching ? <p className="muted-line">جار البحث...</p> : null}

      <div className="virtual-results" ref={parentRef}>
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const product = visibleProducts[virtualRow.index]
            if (!product) return null

            return (
              <div
                key={product.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  left: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ProductResultCard
                  isQuickListed={quickIds.has(product.id)}
                  onAddToCart={handleAddToCart}
                  onQuantityChange={(offerId, quantity) =>
                    setQuantities((current) => ({ ...current, [offerId]: quantity }))
                  }
                  onToggleQuickList={toggleQuickList}
                  product={product}
                  quantities={quantities}
                />
              </div>
            )
          })}
        </div>
      </div>

      {!isSearching && visibleProducts.length === 0 ? (
        <Card className="empty-state">
          <Star size={28} />
          <h2>{query.trim().length >= 2 ? 'لا توجد نتائج مطابقة' : 'ابدأ بالبحث أو استخدم قائمتك السريعة'}</h2>
          <p>ستظهر عروض المخازن المتاحة هنا مع الأسعار والتوفر.</p>
        </Card>
      ) : null}
    </section>
  )
}

interface ProductResultCardProps {
  isQuickListed: boolean
  onAddToCart: (offer: ProductOffer) => Promise<void>
  onQuantityChange: (offerId: string, quantity: number) => void
  onToggleQuickList: (product: ProductResult) => Promise<void>
  product: ProductResult
  quantities: QuantityDrafts
}

function ProductResultCard({
  isQuickListed,
  onAddToCart,
  onQuantityChange,
  onToggleQuickList,
  product,
  quantities,
}: ProductResultCardProps) {
  return (
    <Card className="product-result-card">
      <div className="product-result-head">
        <div>
          <p className="eyebrow">{product.productCode}</p>
          <h2>{product.canonicalName}</h2>
          <p>{[product.strength, product.form, product.packSize].filter(Boolean).join(' • ')}</p>
        </div>
        <Button onClick={() => void onToggleQuickList(product)} type="button" variant={isQuickListed ? 'secondary' : 'ghost'}>
          <Star size={18} />
          {isQuickListed ? 'إزالة من القائمة' : 'أضف للقائمة'}
        </Button>
      </div>

      <div className="offers-list">
        {product.offers.length === 0 ? (
          <p className="muted-line">لا توجد عروض متاحة حاليا.</p>
        ) : (
          <>
            {!product.offers.some((offer) => offer.isAvailable) ? (
              <p className="muted-line">لا توجد عروض متاحة حاليا لهذا الصنف.</p>
            ) : null}
            {product.offers.map((offer) => {
            const freshness = freshnessLabel(offer.warehouseLastPriceUpdate)
            const quantity = quantities[offer.id] ?? 1

            return (
              <div className="offer-row" key={offer.id}>
                <div>
                  <strong>{offer.warehouseName}</strong>
                  <p>{offer.warehouseRawName}</p>
                </div>
                <div>
                  <strong>{formatMoney(effectivePrice(offer))}</strong>
                  {offer.discountPct > 0 ? <p>خصم {offer.discountPct}% من {formatMoney(offer.price)}</p> : <p>بدون خصم</p>}
                </div>
                <div>
                  <span className={offer.isAvailable ? 'availability available' : 'availability unavailable'}>
                    {offer.isAvailable ? `متاح: ${offer.stock}` : 'غير متاح'}
                  </span>
                  <span className={freshness.stale ? 'freshness stale' : 'freshness'}>
                    <Clock3 size={14} />
                    {freshness.text}
                  </span>
                </div>
                <div className="cart-controls">
                  <input
                    aria-label="الكمية"
                    disabled={!offer.isAvailable}
                    max={offer.stock}
                    min="1"
                    onChange={(event) => onQuantityChange(offer.id, Math.max(1, Number(event.target.value)))}
                    type="number"
                    value={quantity}
                  />
                  <Button disabled={!offer.isAvailable} onClick={() => void onAddToCart(offer)} type="button">
                    <ShoppingCart size={18} />
                    أضف
                  </Button>
                </div>
              </div>
            )
            })}
          </>
        )}
      </div>
    </Card>
  )
}
