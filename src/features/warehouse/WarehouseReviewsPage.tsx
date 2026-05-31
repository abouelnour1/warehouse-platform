import { Check, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, Card } from '../../components'
import { getAuthMessage } from '../auth/authService'
import { listPendingReviews, resolveReview, type ReviewQueueItem } from './warehouseService'

export function WarehouseReviewsPage() {
  const [items, setItems] = useState<ReviewQueueItem[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function loadItems() {
    setIsLoading(true)
    setError('')
    try {
      setItems(await listPendingReviews())
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadItems()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  async function handleAction(item: ReviewQueueItem, action: 'same' | 'new' | 'ignore') {
    setBusyId(item.id)
    setError('')
    try {
      await resolveReview(item.id, action, item.suggested_product_id ?? undefined)
      setItems((current) => current.filter((row) => row.id !== item.id))
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <p className="eyebrow">مراجعة المطابقة</p>
        <h1>الأصناف غير المؤكدة</h1>
        <p>راجع الأصناف التي لم تصل لدرجة أمان كافية قبل ربطها بالكتالوج.</p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {isLoading ? <Card>جار تحميل قائمة المراجعة...</Card> : null}
      {!isLoading && items.length === 0 ? <Card>لا توجد أصناف بانتظار المراجعة.</Card> : null}

      <div className="review-list">
        {items.map((item) => (
          <Card className="review-row" key={item.id}>
            <div>
              <p className="eyebrow">الاسم الوارد</p>
              <h2>{item.raw_name}</h2>
              <p>
                السعر: {item.raw_price ?? 0} | المخزون: {item.raw_stock ?? 0}
              </p>
            </div>
            <div>
              <p className="eyebrow">الاقتراح</p>
              <h3>{item.products?.canonical_name ?? 'لا يوجد اقتراح'}</h3>
              <p>
                {item.products?.product_code ?? '-'} | الثقة:{' '}
                {Math.round((item.match_score ?? 0) * 100)}%
              </p>
            </div>
            <div className="row-actions">
              <Button
                disabled={busyId === item.id || !item.suggested_product_id}
                onClick={() => void handleAction(item, 'same')}
                type="button"
              >
                <Check size={18} />
                نفس المنتج
              </Button>
              <Button disabled={busyId === item.id} onClick={() => void handleAction(item, 'new')} type="button" variant="secondary">
                <Plus size={18} />
                منتج جديد
              </Button>
              <Button disabled={busyId === item.id} onClick={() => void handleAction(item, 'ignore')} type="button" variant="ghost">
                <X size={18} />
                تجاهل
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
