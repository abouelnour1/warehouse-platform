import { AlertTriangle, Minus, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Button, Card } from '../../components'
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
} from './cartService'

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    currency: 'EGP',
    maximumFractionDigits: 2,
    style: 'currency',
  }).format(value)
}

export function CartPage() {
  const { account } = useAuth()
  const pharmacyId = account?.pharmacy?.id ?? ''
  const [items, setItems] = useState<CartItem[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isConfirming, setIsConfirming] = useState(false)
  const groups = useMemo(() => groupCartItems(items), [items])
  const grandTotal = groups.reduce((sum, group) => sum + group.subtotal, 0)
  const hasMinOrderWarnings = groups.some((group) => group.subtotal < group.minOrderValue)

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
    const timeoutId = window.setTimeout(() => {
      void loadCart()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadCart])

  async function changeQuantity(item: CartItem, nextQuantity: number) {
    setError('')
    try {
      await updateCartQuantity(item.id, nextQuantity)
      await loadCart()
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  async function removeItem(itemId: string) {
    setError('')
    try {
      await removeCartItem(itemId)
      await loadCart()
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  async function confirmOrder() {
    setError('')
    setMessage('')
    setIsConfirming(true)
    try {
      const order = await confirmCartOrder()
      setItems([])
      setMessage(`تم إنشاء الطلب بنجاح. رقم الطلب: ${order.orderCode}`)
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <section className="dashboard-page cart-page">
      <div className="page-heading">
        <p className="eyebrow">السلة</p>
        <h1>مراجعة الطلب قبل التأكيد</h1>
        <p>الأصناف مجمعة حسب المخزن لأن كل مخزن سيحضر ويسلم الجزء الخاص به.</p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {isLoading ? <Card>جار تحميل السلة...</Card> : null}

      {!isLoading && items.length === 0 ? (
        <Card className="empty-state">
          <h2>السلة فارغة</h2>
          <p>ابدأ من البحث لإضافة عروض من المخازن.</p>
          <Link className="button button-primary" to="/app">العودة للبحث</Link>
        </Card>
      ) : null}

      {groups.map((group) => {
        const belowMinimum = group.subtotal < group.minOrderValue

        return (
          <Card className="cart-warehouse-card" key={group.warehouseId}>
            <div className="cart-group-head">
              <div>
                <h2>{group.warehouseName}</h2>
                <p>الإجمالي الفرعي: {formatMoney(group.subtotal)}</p>
              </div>
              <span className={belowMinimum ? 'min-order-badge warning' : 'min-order-badge'}>
                الحد الأدنى: {formatMoney(group.minOrderValue)}
              </span>
            </div>

            {belowMinimum ? (
              <p className="cart-warning">
                <AlertTriangle size={18} />
                هذا الجزء أقل من الحد الأدنى للمخزن. يمكنك تأكيد الطلب، لكن قد يرفضه المخزن.
              </p>
            ) : null}

            <div className="cart-items-list">
              {group.items.map((item) => (
                <div className="cart-item-row" key={item.id}>
                  <div>
                    <strong>{item.warehouseRawName}</strong>
                    <p>{item.productName}</p>
                    {!item.isAvailable ? <span className="availability unavailable">غير متاح حاليا</span> : null}
                  </div>
                  <div>
                    <strong>{formatMoney(lineTotal(item))}</strong>
                    <p>
                      {formatMoney(item.price)}
                      {item.discountPct > 0 ? ` | خصم ${item.discountPct}%` : ''}
                    </p>
                  </div>
                  <div className="cart-qty-controls">
                    <Button onClick={() => void changeQuantity(item, item.quantity - 1)} type="button" variant="ghost">
                      <Minus size={16} />
                    </Button>
                    <input
                      min="1"
                      onChange={(event) => void changeQuantity(item, Number(event.target.value))}
                      type="number"
                      value={item.quantity}
                    />
                    <Button onClick={() => void changeQuantity(item, item.quantity + 1)} type="button" variant="ghost">
                      <Plus size={16} />
                    </Button>
                    <Button onClick={() => void removeItem(item.id)} type="button" variant="ghost">
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )
      })}

      {items.length > 0 ? (
        <Card className="cart-summary-card">
          <div>
            <p className="eyebrow">الإجمالي</p>
            <h2>{formatMoney(grandTotal)}</h2>
            {hasMinOrderWarnings ? <p>توجد تحذيرات حد أدنى لبعض المخازن.</p> : <p>كل أجزاء الطلب مستوفية للحد الأدنى.</p>}
          </div>
          <Button disabled={isConfirming || grandTotal <= 0} onClick={() => void confirmOrder()} type="button">
            {isConfirming ? 'جار إنشاء الطلب...' : 'تأكيد الطلب'}
          </Button>
        </Card>
      ) : null}
    </section>
  )
}
