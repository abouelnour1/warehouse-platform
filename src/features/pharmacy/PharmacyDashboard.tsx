import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Clock3,
  Eye,
  Loader2,
  Package,
  PackagePlus,
  Search,
  ShoppingCart,
  Star,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { Button, Card } from '../../components'
import { supabase } from '../../lib/supabase'
import { getAuthMessage } from '../auth/authService'
import { useAuth } from '../auth/useAuth'
import {
  addOfferToCart,
  addProductToQuickList,
  loadQuickListProductIds,
  loadQuickListProducts,
  loadRecentlyOrderedNames,
  removeProductFromQuickList,
} from './pharmacyService'
import { effectivePrice, searchProvider, type ProductOffer, type ProductResult } from './searchProvider'
import { useRecentSearches } from './useRecentSearches'

type QuantityDrafts = Record<string, number>

// ── Utilities ────────────────────────────────────────────────────────────────

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

// ── Highlight helper ─────────────────────────────────────────────────────────

// Normalise Arabic letter variants so highlighted positions align with originals.
// All replacements are 1-to-1 so string indices are preserved.
function normForHL(s: string): string {
  return s
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')      // أإآٱ → ا
    .replace(/ة/g, 'ه')                            // ة → ه
    .replace(/ى/g, 'ي')                            // ى → ي
    .replace(/[٠-٩]/g, (c) =>                     // ١٢٣ → 123
      String.fromCharCode(c.charCodeAt(0) - 0x0630))
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>

  const normText  = normForHL(text)
  const normQuery = normForHL(q)

  let start = normText.indexOf(normQuery)
  let len   = normQuery.length

  if (start === -1) {
    const firstWord = normQuery.split(/\s+/)[0]
    if (firstWord) { start = normText.indexOf(firstWord); len = firstWord.length }
  }

  if (start === -1) return <>{text}</>

  return (
    <>
      {text.slice(0, start)}
      <mark className="search-highlight">{text.slice(start, start + len)}</mark>
      {text.slice(start + len)}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PharmacyDashboard() {
  const { account } = useAuth()
  const pharmacyId = account?.pharmacy?.id ?? ''

  // ── Search state ──────────────────────────────────────────────────────────
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<ProductResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [suggestions, setSuggestions] = useState<ProductResult[]>([])
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [recentOrdered, setRecentOrdered] = useState<string[]>([])

  const { recents, push: saveRecent, remove: removeRecent } = useRecentSearches()

  // ── Quick list state ──────────────────────────────────────────────────────
  const [quickProducts, setQuickProducts] = useState<ProductResult[]>([])
  const [quickIds, setQuickIds]           = useState<Set<string>>(new Set())
  const [openedQuickProductId, setOpenedQuickProductId] = useState<string | null>(null)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [quantities, setQuantities] = useState<QuantityDrafts>({})
  const [error, setError]     = useState('')
  const [message, setMessage] = useState('')

  const inputRef  = useRef<HTMLInputElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const parentRef = useRef<HTMLDivElement | null>(null)

  // ── Virtualiser ───────────────────────────────────────────────────────────

  const visibleProducts = query.trim().length >= 2
    ? results
    : openedQuickProductId
      ? quickProducts.filter((p) => p.id === openedQuickProductId)
      : quickProducts

  const productIds = useMemo(
    () => visibleProducts.map((p) => p.id),
    [visibleProducts],
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: visibleProducts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 280,
    overscan: 4,
  })

  // ── Data loaders ──────────────────────────────────────────────────────────

  const refreshOffers = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const offerMap = await searchProvider.loadOffers(ids)
    const apply = (cur: ProductResult[]) =>
      cur.map((p) => ({ ...p, offers: offerMap[p.id] ?? p.offers }))
    setResults(apply)
    setQuickProducts(apply)
  }, [])

  const loadQuickList = useCallback(async () => {
    if (!pharmacyId) return
    const [ids, products] = await Promise.all([
      loadQuickListProductIds(pharmacyId),
      loadQuickListProducts(pharmacyId),
    ])
    const offerMap = await searchProvider.loadOffers(products.map((p) => p.id))
    setQuickIds(ids)
    setQuickProducts(
      products.map((p) => ({ ...p, offers: offerMap[p.id] ?? [] })),
    )
  }, [pharmacyId])

  // Initial data
  useEffect(() => {
    const id = window.setTimeout(() => void loadQuickList().catch((err) => setError(getAuthMessage(err))), 0)
    return () => window.clearTimeout(id)
  }, [loadQuickList])

  useEffect(() => {
    if (!pharmacyId) return
    void loadRecentlyOrderedNames(pharmacyId)
      .then(setRecentOrdered)
      .catch(() => setRecentOrdered([]))
  }, [pharmacyId])

  // Realtime offers refresh
  useEffect(() => {
    const channel = supabase
      .channel('pharmacy-offers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, () => {
        void refreshOffers(productIds).catch((err) => setError(getAuthMessage(err)))
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [productIds, refreshOffers])

  // Autocomplete suggestions — 200 ms debounce, no offers
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 1) { setSuggestions([]); setIsSuggesting(false); return }

    setIsSuggesting(true)
    let cancelled = false

    const id = window.setTimeout(async () => {
      try {
        const data = await searchProvider.suggest(trimmed)
        if (!cancelled) setSuggestions(data)
      } catch {
        if (!cancelled) setSuggestions([])
      } finally {
        if (!cancelled) setIsSuggesting(false)
      }
    }, 200)

    return () => { cancelled = true; window.clearTimeout(id) }
  }, [query])

  // Full search with offers — 250 ms debounce
  useEffect(() => {
    const trimmed = query.trim()
    const id = window.setTimeout(() => {
      if (trimmed.length < 2) { setResults([]); setIsSearching(false); return }
      setIsSearching(true)
      setError('')
      void searchProvider
        .search(trimmed)
        .then(setResults)
        .catch((err) => setError(getAuthMessage(err)))
        .finally(() => setIsSearching(false))
    }, 250)

    return () => window.clearTimeout(id)
  }, [query])

  // ── Dropdown logic ────────────────────────────────────────────────────────

  const showDropdown = dropdownOpen && (
    query.trim().length === 0
      ? recents.length > 0 || recentOrdered.length > 0
      : true
  )

  function handleWrapperFocus() { setDropdownOpen(true) }

  function handleWrapperBlur(e: React.FocusEvent) {
    if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
      setDropdownOpen(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setDropdownOpen(false); inputRef.current?.blur() }
    if (e.key === 'Enter' && query.trim().length >= 2) {
      saveRecent(query.trim())
      setDropdownOpen(false)
    }
  }

  function selectSuggestion(name: string) {
    setQuery(name)
    saveRecent(name)
    setDropdownOpen(false)
    setSuggestions([])
  }

  function selectRecent(q: string) {
    setQuery(q)
    setDropdownOpen(false)
    inputRef.current?.focus()
  }

  // ── Action handlers ───────────────────────────────────────────────────────

  async function handleAddToCart(offer: ProductOffer) {
    if (!pharmacyId) return
    setError(''); setMessage('')
    try {
      await addOfferToCart(pharmacyId, offer.id, quantities[offer.id] ?? 1)
      setMessage('تمت إضافة العرض إلى السلة.')
    } catch (err) { setError(getAuthMessage(err)) }
  }

  async function toggleQuickList(product: ProductResult) {
    if (!pharmacyId) return
    setError(''); setMessage('')
    try {
      if (quickIds.has(product.id)) {
        await removeProductFromQuickList(pharmacyId, product.id)
        setQuickIds((cur) => { const n = new Set(cur); n.delete(product.id); return n })
        setQuickProducts((cur) => cur.filter((p) => p.id !== product.id))
        setOpenedQuickProductId((cur) => cur === product.id ? null : cur)
      } else {
        await addProductToQuickList(pharmacyId, product.id)
        setQuickIds((cur) => new Set(cur).add(product.id))
        setMessage('تمت إضافة الصنف إلى القائمة السريعة.')
      }
    } catch (err) { setError(getAuthMessage(err)) }
  }

  async function openQuickListProduct(productId: string) {
    setError(''); setMessage('')
    try {
      const offerMap = await searchProvider.loadOffers([productId])
      setQuickProducts((cur) =>
        cur.map((p) => p.id === productId ? { ...p, offers: offerMap[p.id] ?? [] } : p),
      )
      setOpenedQuickProductId(productId)
    } catch (err) { setError(getAuthMessage(err)) }
  }

  async function addQuickListToCart() {
    if (!pharmacyId) return
    setError(''); setMessage('')
    try {
      const best = quickProducts.flatMap((p) => p.offers.find((o) => o.isAvailable) ?? [])
      await Promise.all(best.map((o) => addOfferToCart(pharmacyId, o.id, 1)))
      setMessage(`تمت إضافة ${best.length} عرض من القائمة السريعة إلى السلة.`)
    } catch (err) { setError(getAuthMessage(err)) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="dashboard-page search-page">
      <div className="page-heading">
        <p className="eyebrow">البحث والمقارنة</p>
        <h1>{account?.pharmacy?.pharmacy_name ?? 'صيدليتي'}</h1>
        <p>ابحث عن الصنف وشاهد عروض المخازن مرتبة من الأرخص إلى الأعلى مع تحديث فوري للأسعار.</p>
      </div>

      <Card className="search-panel">
        {/* ── Smart search box ──────────────────────────────────── */}
        <div
          ref={wrapRef}
          className="search-box-wrap"
          onBlur={handleWrapperBlur}
          onFocus={handleWrapperFocus}
        >
          <div className="search-box">
            <Search size={22} />
            <input
              ref={inputRef}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ابحث باسم الصنف، التركيز، الكود، أو المادة الفعالة"
              type="search"
              value={query}
            />
            {isSearching && <Loader2 className="search-spinner" size={18} />}
            {query.length > 0 && !isSearching && (
              <button
                aria-label="مسح البحث"
                className="search-clear"
                onMouseDown={(e) => { e.preventDefault(); setQuery('') }}
                type="button"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* ── Dropdown ─────────────────────────────────────────── */}
          {showDropdown && (
            <div
              aria-label="اقتراحات البحث"
              className="search-dropdown"
              role="listbox"
            >
              {query.trim().length === 0 ? (
                /* Empty state: recents + recently ordered */
                <>
                  {recents.length > 0 && (
                    <div className="search-section">
                      <span className="search-section-label">
                        <Clock3 size={12} />
                        بحث سابق
                      </span>
                      <ul className="search-suggestions">
                        {recents.map((r) => (
                          <li className="search-suggestion" key={r}>
                            <button
                              className="suggestion-btn"
                              onMouseDown={() => selectRecent(r)}
                              type="button"
                            >
                              <Clock3 size={15} />
                              <span className="suggestion-name">{r}</span>
                            </button>
                            <button
                              aria-label={`حذف "${r}" من السجل`}
                              className="suggestion-remove"
                              onMouseDown={(e) => { e.stopPropagation(); removeRecent(r) }}
                              type="button"
                            >
                              <X size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {recentOrdered.length > 0 && (
                    <div className="search-section">
                      <span className="search-section-label">
                        <Package size={12} />
                        طلبت مؤخراً
                      </span>
                      <ul className="search-suggestions">
                        {recentOrdered.map((name) => (
                          <li className="search-suggestion" key={name}>
                            <button
                              className="suggestion-btn"
                              onMouseDown={() => selectRecent(name)}
                              type="button"
                            >
                              <Package size={15} />
                              <span className="suggestion-name">{name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : isSuggesting ? (
                <div className="search-dropdown-status">
                  <Loader2 className="search-spinner" size={15} />
                  <span>جارٍ البحث…</span>
                </div>
              ) : suggestions.length > 0 ? (
                <ul className="search-suggestions">
                  {suggestions.map((product) => (
                    <li className="search-suggestion" key={product.id}>
                      <button
                        className="suggestion-btn"
                        onMouseDown={() => selectSuggestion(product.canonicalName)}
                        type="button"
                      >
                        <Search size={15} />
                        <div className="suggestion-content">
                          <span className="suggestion-name">
                            <HighlightMatch query={query} text={product.canonicalName} />
                          </span>
                          {(product.brand || product.strength || product.form) && (
                            <span className="suggestion-meta">
                              {[product.brand, product.strength, product.form]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="search-dropdown-status">
                  <span>لا توجد اقتراحات لـ «{query.trim()}»</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Quick list panel ─────────────────────────────────── */}
        <div className="quick-list-bar">
          <div>
            <strong>قائمتي السريعة</strong>
            <p>{quickProducts.length} صنف محفوظ</p>
          </div>
          <Button
            disabled={quickProducts.length === 0}
            onClick={() => void addQuickListToCart()}
            type="button"
            variant="secondary"
          >
            <PackagePlus size={18} />
            أضف الكل للسلة
          </Button>
        </div>

        {quickProducts.length > 0 && (
          <div className="quick-list-items">
            <Button onClick={() => setOpenedQuickProductId(null)} type="button" variant="ghost">
              عرض الكل
            </Button>
            {quickProducts.map((product) => (
              <Button
                key={product.id}
                onClick={() => void openQuickListProduct(product.id)}
                type="button"
                variant="ghost"
              >
                <Eye size={16} />
                {product.canonicalName}
              </Button>
            ))}
          </div>
        )}
      </Card>

      {error   && <p className="form-error">{error}</p>}
      {message && <p className="form-success">{message}</p>}

      {/* ── Search-in-progress notice (only when results haven't arrived yet) */}
      {isSearching && results.length === 0 && (
        <p className="muted-line">جار البحث...</p>
      )}

      {/* ── Virtualised result list ───────────────────────────── */}
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
                  top: 0, right: 0, left: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ProductResultCard
                  isQuickListed={quickIds.has(product.id)}
                  onAddToCart={handleAddToCart}
                  onQuantityChange={(offerId, qty) =>
                    setQuantities((cur) => ({ ...cur, [offerId]: qty }))
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

      {!isSearching && visibleProducts.length === 0 && (
        <Card className="empty-state">
          <Star size={28} />
          <h2>
            {query.trim().length >= 2
              ? 'لا توجد نتائج مطابقة'
              : 'ابدأ بالبحث أو استخدم قائمتك السريعة'}
          </h2>
          <p>ستظهر عروض المخازن المتاحة هنا مع الأسعار والتوفر.</p>
        </Card>
      )}
    </section>
  )
}

// ── ProductResultCard ─────────────────────────────────────────────────────────

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
        <Button
          onClick={() => void onToggleQuickList(product)}
          type="button"
          variant={isQuickListed ? 'secondary' : 'ghost'}
        >
          <Star size={18} />
          {isQuickListed ? 'إزالة من القائمة' : 'أضف للقائمة'}
        </Button>
      </div>

      <div className="offers-list">
        {product.offers.length === 0 ? (
          <p className="muted-line">لا توجد عروض متاحة حاليا.</p>
        ) : (
          <>
            {!product.offers.some((o) => o.isAvailable) && (
              <p className="muted-line">لا توجد عروض متاحة حاليا لهذا الصنف.</p>
            )}
            {product.offers.map((offer) => {
              const freshness = freshnessLabel(offer.warehouseLastPriceUpdate)
              const quantity  = quantities[offer.id] ?? 1
              return (
                <div className="offer-row" key={offer.id}>
                  <div>
                    <strong>{offer.warehouseName}</strong>
                    <p>{offer.warehouseRawName}</p>
                  </div>
                  <div>
                    <strong>{formatMoney(effectivePrice(offer))}</strong>
                    {offer.discountPct > 0
                      ? <p>خصم {offer.discountPct}% من {formatMoney(offer.price)}</p>
                      : <p>بدون خصم</p>}
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
                      onChange={(e) =>
                        onQuantityChange(offer.id, Math.max(1, Number(e.target.value)))
                      }
                      type="number"
                      value={quantity}
                    />
                    <Button
                      disabled={!offer.isAvailable}
                      onClick={() => void onAddToCart(offer)}
                      type="button"
                    >
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
