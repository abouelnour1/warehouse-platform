import { GitMerge, PackageSearch, Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button, Card, Field } from '../../components'
import { getAuthMessage } from '../auth/authService'
import { loadProducts, mergeProducts, updateProduct, type AdminProduct } from './adminService'

interface ProductDraft {
  productCode: string
  isVerified: boolean
  mergeTargetId: string
}

function createDraft(product: AdminProduct): ProductDraft {
  return {
    productCode: product.product_code,
    isVerified: product.is_verified,
    mergeTargetId: '',
  }
}

export function AdminCatalogPage() {
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [drafts, setDrafts] = useState<Record<string, ProductDraft>>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadCatalog = useCallback(async () => {
    setError('')
    setIsLoading(true)
    try {
      const rows = await loadProducts()
      setProducts(rows)
      setDrafts(Object.fromEntries(rows.map((product) => [product.id, createDraft(product)])))
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadCatalog(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadCatalog])

  function setDraft(productId: string, patch: Partial<ProductDraft>) {
    setDrafts((current) => ({
      ...current,
      [productId]: { ...current[productId], ...patch },
    }))
  }

  async function saveProduct(product: AdminProduct) {
    const draft = drafts[product.id] ?? createDraft(product)
    setBusyId(product.id)
    setError('')
    setMessage('')
    try {
      await updateProduct(product.id, draft.productCode, draft.isVerified)
      setMessage('تم تحديث المنتج.')
      await loadCatalog()
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function mergeProduct(product: AdminProduct) {
    const draft = drafts[product.id] ?? createDraft(product)
    if (!draft.mergeTargetId) return
    setBusyId(product.id)
    setError('')
    setMessage('')
    try {
      await mergeProducts(product.id, draft.mergeTargetId)
      setMessage('تم دمج المنتج.')
      await loadCatalog()
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="dashboard-page admin-page">
      <div className="page-heading">
        <p className="eyebrow">الإدارة</p>
        <h1>الكتالوج</h1>
        <p>مراجعة المنتجات والتحقق من بياناتها ودمج الأصناف المكررة.</p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {isLoading ? <Card>جار تحميل الكتالوج...</Card> : null}

      {!isLoading && products.length === 0 ? (
        <Card className="empty-state">
          <PackageSearch size={28} />
          <h2>لا توجد منتجات في الكتالوج</h2>
          <p>ستظهر المنتجات هنا بعد رفع ملف أسعار من أحد المخازن.</p>
        </Card>
      ) : null}

      <div className="admin-table-list">
        {products.map((product) => {
          const draft = drafts[product.id] ?? createDraft(product)
          const offerCount = product.offers[0]?.count ?? 0

          return (
            <Card className="admin-product-card" key={product.id}>
              <div className="admin-product-summary">
                <div>
                  <span className="admin-cell-label">{product.product_code}</span>
                  <strong>{product.canonical_name}</strong>
                  <p>{[product.strength, product.form].filter(Boolean).join(' | ') || 'لا توجد تفاصيل إضافية'}</p>
                </div>
                <div className="admin-product-meta">
                  <span className={`order-status ${product.is_verified ? 'status-delivered' : 'status-pending'}`}>
                    {product.is_verified ? 'موثّق' : 'بحاجة إلى مراجعة'}
                  </span>
                  <span className="status-pill">{offerCount} عرض</span>
                </div>
              </div>

              <div className="admin-product-actions">
                <Field
                  label="كود المنتج"
                  name={`product-code-${product.id}`}
                  onChange={(event) => setDraft(product.id, { productCode: event.target.value })}
                  value={draft.productCode}
                />
                <label className="inline-check">
                  <input
                    checked={draft.isVerified}
                    onChange={(event) => setDraft(product.id, { isVerified: event.target.checked })}
                    type="checkbox"
                  />
                  موثّق
                </label>
                <Button disabled={busyId === product.id} onClick={() => void saveProduct(product)} type="button">
                  <Save size={18} />
                  حفظ
                </Button>
              </div>

              <div className="admin-product-merge">
                <label>
                  <span>دمج المنتج المكرر داخل منتج آخر</span>
                  <select onChange={(event) => setDraft(product.id, { mergeTargetId: event.target.value })} value={draft.mergeTargetId}>
                    <option value="">اختر المنتج الهدف</option>
                    {products.filter((target) => target.id !== product.id).map((target) => (
                      <option key={target.id} value={target.id}>{target.product_code} | {target.canonical_name}</option>
                    ))}
                  </select>
                </label>
                <Button disabled={busyId === product.id || !draft.mergeTargetId} onClick={() => void mergeProduct(product)} type="button" variant="secondary">
                  <GitMerge size={18} />
                  دمج
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
