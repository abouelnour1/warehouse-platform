import { Plus, Save } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { Button, Card, Field } from '../../components'
import { getAuthMessage } from '../auth/authService'
import {
  listWarehouseOffers,
  manualAddOffer,
  updateWarehouseOffer,
  type WarehouseOffer,
} from './warehouseService'

export function WarehouseProductsPage() {
  const [offers, setOffers] = useState<WarehouseOffer[]>([])
  const [drafts, setDrafts] = useState<Record<string, { price: string; stock: string }>>({})
  const [rawName, setRawName] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [barcode, setBarcode] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function loadOffers() {
    setIsLoading(true)
    setError('')
    try {
      const rows = await listWarehouseOffers()
      setOffers(rows)
      setDrafts(Object.fromEntries(rows.map((offer) => [offer.id, { price: String(offer.price), stock: String(offer.stock) }])))
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOffers()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  async function saveOffer(offer: WarehouseOffer) {
    const draft = drafts[offer.id]
    if (!draft) return
    setBusyId(offer.id)
    setError('')
    setMessage('')
    try {
      await updateWarehouseOffer(offer.id, Number(draft.price), Number(draft.stock))
      setMessage('تم حفظ العرض.')
      await loadOffers()
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function handleManualAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusyId('manual')
    setError('')
    setMessage('')
    try {
      await manualAddOffer(rawName, Number(price), Number(stock), barcode)
      setRawName('')
      setPrice('')
      setStock('')
      setBarcode('')
      setMessage('تمت إضافة المنتج.')
      await loadOffers()
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <p className="eyebrow">منتجاتي</p>
        <h1>العروض والأسعار</h1>
        <p>عدّل السعر والمخزون بسرعة، أو أضف صنفا يدويا عند الحاجة.</p>
      </div>

      <Card>
        <form className="manual-form" onSubmit={handleManualAdd}>
          <Field label="اسم الصنف" name="rawName" onChange={(event) => setRawName(event.target.value)} required value={rawName} />
          <Field label="السعر" min="0" name="price" onChange={(event) => setPrice(event.target.value)} required step="0.01" type="number" value={price} />
          <Field label="المخزون" min="0" name="stock" onChange={(event) => setStock(event.target.value)} required type="number" value={stock} />
          <Field label="الباركود" name="barcode" onChange={(event) => setBarcode(event.target.value)} value={barcode} />
          <Button disabled={busyId === 'manual'} type="submit">
            <Plus size={18} />
            إضافة
          </Button>
        </form>
      </Card>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <Card className="table-card">
        {isLoading ? (
          <p>جار تحميل العروض...</p>
        ) : (
          <div className="offers-table">
            <div className="table-head">
              <span>الصنف</span>
              <span>الكود</span>
              <span>السعر</span>
              <span>المخزون</span>
              <span>حفظ</span>
            </div>
            {offers.map((offer) => (
              <div className="table-row" key={offer.id}>
                <span>{offer.warehouse_raw_name}</span>
                <span>{offer.products?.product_code ?? '-'}</span>
                <input
                  min="0"
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [offer.id]: { ...current[offer.id], price: event.target.value },
                    }))
                  }
                  step="0.01"
                  type="number"
                  value={drafts[offer.id]?.price ?? ''}
                />
                <input
                  min="0"
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [offer.id]: { ...current[offer.id], stock: event.target.value },
                    }))
                  }
                  type="number"
                  value={drafts[offer.id]?.stock ?? ''}
                />
                <Button disabled={busyId === offer.id} onClick={() => void saveOffer(offer)} type="button" variant="ghost">
                  <Save size={18} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  )
}
