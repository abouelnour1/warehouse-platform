import { AlertTriangle, CheckCircle2, Package, Search, ShoppingCart, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Button, Card, QtyStepper } from '../../components'
import { getAuthMessage } from '../auth/authService'
import { useAuth } from '../auth/useAuth'
import {
  confirmCartOrder,
  groupCartItems,
  lineTotal,
  loadCartItems,
  removeCartItem,
  updateCartQuantity,
  type CartItem,
  type ConfirmedOrder,
} from './cartService'

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    currency: 'EGP',
    maximumFractionDigits: 2,
    style: 'currency',
  }).format(value)
}

function effectiveUnit(item: CartItem): number {
  return item.price * (1 - item.discountPct / 100)
}

// ── CartPage ──────────────────────────────────────────────────────────────────

export function CartPage() {
  const { account } = useAuth()
  const pharmacyId = account?.pharmacy?.id ?? ''

  const [items, setItems]             = useState<CartItem[]>([])
  const [error, setError]             = useState('')
  const [isLoading, setIsLoading]     = useState(true)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmedOrder, setConfirmedOrder] =
    useState<(ConfirmedOrder & { warehouseCount: number; grandTotal: number }) | null>(null)

  const groups        = useMemo(() => groupCartItems(items), [items])
  const grandTotal    = groups.reduce((sum, g) => sum + g.subtotal, 0)
  const warnGroups    = groups.filter((g) => g.subtotal > 0 && g.subtotal < g.minOrderValue)

  // ── Data loading ────────────────────────────────────────────────────────

  const loadCart = useCallback(async () => {
    if (!pharmacyId) return
    setIsLoading(true)
    setError('')
    try {
      setItems(await loadCartItems(pharmacyId))
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [pharmacyId])

  useEffect(() => {
    const id = window.setTimeout(() => void loadCart(), 0)
    return () => window.clearTimeout(id)
  }, [loadCart])

  // ── Actions ─────────────────────────────────────────────────────────────

  async function changeQuantity(itemId: string, nextQty: number) {
    if (nextQty <= 0) { void removeItem(itemId); return }
    // Optimistic
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, quantity: nextQty } : i)))
    try {
      await updateCartQuantity(itemId, nextQty)
    } catch (err) {
      setError(getAuthMessage(err))
      void loadCart()
    }
  }

  async function removeItem(itemId: string) {
    // Optimistic
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    try {
      await removeCartItem(itemId)
    } catch (err) {
      setError(getAuthMessage(err))
      void loadCart()
    }
  }

  async function confirmOrder() {
    setError('')
    setIsConfirming(true)
    try {
      const order = await confirmCartOrder()
      const warehouseCount = groups.length
      const total = grandTotal
      setItems([])
      setConfirmedOrder({ ...order, warehouseCount, grandTotal: total })
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsConfirming(false)
    }
  }

  // ── Success state ────────────────────────────────────────────────────────

  if (confirmedOrder) {
    return (
      <section className="dashboard-page cart-page">
        <Card className="order-success-card">
          <div className="order-success-icon">
            <CheckCircle2 size={44} />
          </div>

          <div className="order-success-text">
            <h2>تم إنشاء طلبك بنجاح!</h2>
            <p>
              سيبدأ{' '}
              {confirmedOrder.warehouseCount === 1
                ? 'المخزن'
                : `${confirmedOrder.warehouseCount} مخازن`}{' '}
              بتجهيز طلبك قريباً.
            </p>
          </div>

          <div className="order-success-meta">
            <span className="order-success-label">رقم الطلب</span>
            <span className="order-code-display">{confirmedOrder.orderCode}</span>
            <span className="order-success-total">{formatMoney(confirmedOrder.grandTotal)}</span>
          </div>

          <div className="actions-row">
            <Link className="button button-primary" to="/orders">
              <Package size={18} />
              متابعة الطلبات
            </Link>
            <Link className="button button-ghost" to="/app">
              <Search size={18} />
              مواصلة التسوق
            </Link>
          </div>
        </Card>
      </section>
    )
  }

  // ── Main cart ────────────────────────────────────────────────────────────

  return (
    <section className="dashboard-page cart-page">
      <div className="page-heading">
        <p className="eyebrow">السلة</p>
        <h1>مراجعة الطلب</h1>
        <p>الأصناف مجمّعة حسب المخزن — كل مخزن ينفّذ ويسلّم جزءه بشكل مستقل.</p>
      </div>

      {error && <p className="form-error">{error}</p>}

      {/* ── Loading ──────────────────────────────────────────────────── */}
      {isLoading && (
        <Card>
          <p className="muted-line">جار تحميل السلة…</p>
        </Card>
      )}

      {/* ── Empty ────────────────────────────────────────────────────── */}
      {!isLoading && items.length === 0 && (
        <Card className="empty-state">
          <ShoppingCart size={40} />
          <h2>السلة فارغة</h2>
          <p>ابدأ من البحث لإضافة عروض من المخازن.</p>
          <Link className="button button-primary" to="/app">
            <Search size={18} />
            العودة للبحث
          </Link>
        </Card>
      )}

      {/* ── Warehouse groups ─────────────────────────────────────────── */}
      {groups.map((group) => {
        const belowMin = group.subtotal > 0 && group.subtotal < group.minOrderValue

        return (
          <Card className="cart-warehouse-card" key={group.warehouseId}>
            {/* Group header */}
            <div className="cart-group-head">
              <div>
                <h2>{group.warehouseName}</h2>
                <p className="cart-group-meta">
                  {group.items.length} {group.items.length === 1 ? 'صنف' : 'أصناف'}
                  {' · '}
                  الإجمالي:&nbsp;<strong>{formatMoney(group.subtotal)}</strong>
                </p>
              </div>
              <span className={belowMin ? 'min-order-badge warning' : 'min-order-badge'}>
                حد أدنى: {formatMoney(group.minOrderValue)}
              </span>
            </div>

            {/* Min order warning */}
            {belowMin && (
              <p className="cart-warning">
                <AlertTriangle size={16} />
                الطلب ({formatMoney(group.subtotal)}) أقل من الحد الأدنى ({formatMoney(group.minOrderValue)}) — قد يرفضه المخزن.
              </p>
            )}

            {/* Items */}
            <div className="cart-items-list">
              {group.items.map((item) => (
                <div className="cart-item-row" key={item.id}>
                  {/* Product info */}
                  <div className="cart-item-info">
                    <strong className="cart-item-name">{item.productName}</strong>
                    {item.warehouseRawName !== item.productName && (
                      <p className="cart-item-raw">{item.warehouseRawName}</p>
                    )}
                    {!item.isAvailable && (
                      <span className="availability unavailable">غير متاح حالياً</span>
                    )}
                  </div>

                  {/* Price breakdown */}
                  <div className="cart-item-pricing">
                    <strong className="cart-item-total">{formatMoney(lineTotal(item))}</strong>
                    <p className="cart-item-unit">
                      {formatMoney(effectiveUnit(item))} × {item.quantity}
                      {item.discountPct > 0 && (
                        <span className="cart-item-discount"> (خصم {item.discountPct}٪)</span>
                      )}
                    </p>
                  </div>

                  {/* Controls */}
                  <div className="cart-item-controls">
                    <QtyStepper
                      disabled={!item.isAvailable}
                      max={item.stock || 999}
                      onChange={(qty) => void changeQuantity(item.id, qty)}
                      value={item.quantity}
                    />
                    <button
                      aria-label="حذف الصنف من السلة"
                      className="cart-remove-btn"
                      onClick={() => void removeItem(item.id)}
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )
      })}

      {/* ── Checkout summary + confirm ─────────────────────────────── */}
      {items.length > 0 && (
        <Card className="cart-checkout-card">
          {/* Warehouse breakdown */}
          <div className="checkout-breakdown">
            <p className="checkout-breakdown-title">
              <ShoppingCart size={14} />
              ملخص الطلب — {groups.length} {groups.length === 1 ? 'مخزن' : 'مخازن'}
            </p>
            {groups.map((group) => (
              <div className="checkout-breakdown-item" key={group.warehouseId}>
                <span className="checkout-wh-name">{group.warehouseName}</span>
                <span className="checkout-wh-items">
                  {group.items.length} {group.items.length === 1 ? 'صنف' : 'أصناف'}
                </span>
                <strong className="checkout-wh-subtotal">{formatMoney(group.subtotal)}</strong>
              </div>
            ))}
          </div>

          {/* Grand total */}
          <div className="checkout-total-row">
            <span className="checkout-total-label">الإجمالي الكلي</span>
            <strong className="checkout-grand-total">{formatMoney(grandTotal)}</strong>
          </div>

          {/* Warnings summary */}
          {warnGroups.length > 0 && (
            <p className="checkout-warning-note">
              <AlertTriangle size={14} />
              {warnGroups.length === 1
                ? `"${warnGroups[0]!.warehouseName}" لم يصل للحد الأدنى — قد يرفض الطلب.`
                : `${warnGroups.length} مخازن لم تصل للحد الأدنى — قد ترفض الطلبات.`}
            </p>
          )}

          {/* Confirm */}
          <Button
            className="checkout-confirm-btn"
            disabled={isConfirming || grandTotal <= 0}
            onClick={() => void confirmOrder()}
            type="button"
          >
            {isConfirming ? (
              'جار إنشاء الطلب…'
            ) : (
              <>
                <ShoppingCart size={18} />
                تأكيد الطلب · {formatMoney(grandTotal)}
              </>
            )}
          </Button>
        </Card>
      )}
    </section>
  )
}
