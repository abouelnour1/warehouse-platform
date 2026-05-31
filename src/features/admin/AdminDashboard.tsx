import { BadgePercent, Check, GitMerge, ShieldCheck, Warehouse, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button, Card } from '../../components'
import { getAuthMessage } from '../auth/authService'
import {
  loadAdminStats,
  loadCommissionConfig,
  loadMatchMetrics,
  loadPendingWarehouses,
  loadProducts,
  loadWarehouseOptions,
  mergeProducts,
  setCommissionRate,
  setWarehouseStatus,
  updateProduct,
  type AdminProduct,
  type AdminStats,
  type AdminWarehouseOption,
  type CommissionConfigRow,
  type MatchMetricRow,
  type PendingWarehouse,
} from './adminService'

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ar-EG', { currency: 'EGP', style: 'currency' }).format(value)
}

function rate(metric: MatchMetricRow, key: 'auto_count' | 'review_count' | 'new_count'): number {
  const total = metric.auto_count + metric.review_count + metric.new_count
  return total === 0 ? 0 : Math.round((metric[key] / total) * 100)
}

export function AdminDashboard() {
  const [pendingWarehouses, setPendingWarehouses] = useState<PendingWarehouse[]>([])
  const [commissionRows, setCommissionRows] = useState<CommissionConfigRow[]>([])
  const [warehouses, setWarehouses] = useState<AdminWarehouseOption[]>([])
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [metrics, setMetrics] = useState<MatchMetricRow[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [globalRate, setGlobalRate] = useState('5')
  const [specificWarehouseId, setSpecificWarehouseId] = useState('')
  const [specificRate, setSpecificRate] = useState('5')
  const [targetBySource, setTargetBySource] = useState<Record<string, string>>({})
  const [productDrafts, setProductDrafts] = useState<Record<string, { productCode: string; isVerified: boolean }>>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const globalCommission = useMemo(
    () => commissionRows.find((row) => row.warehouse_id === null),
    [commissionRows],
  )

  const loadDashboard = useCallback(async () => {
    setError('')
    setIsLoading(true)
    try {
      const [pending, commission, warehouseOptions, productRows, metricRows, statRow] = await Promise.all([
        loadPendingWarehouses(),
        loadCommissionConfig(),
        loadWarehouseOptions(),
        loadProducts(),
        loadMatchMetrics(),
        loadAdminStats(),
      ])
      setPendingWarehouses(pending)
      setCommissionRows(commission)
      setWarehouses(warehouseOptions)
      setProducts(productRows)
      setMetrics(metricRows)
      setStats(statRow)
      setGlobalRate(String(commission.find((row) => row.warehouse_id === null)?.commission_pct ?? 5))
      setProductDrafts(
        Object.fromEntries(productRows.map((product) => [
          product.id,
          { productCode: product.product_code, isVerified: product.is_verified },
        ])),
      )
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDashboard()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadDashboard])

  async function runAdminAction(action: () => Promise<void>, successMessage: string) {
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(successMessage)
      await loadDashboard()
    } catch (err) {
      setError(getAuthMessage(err))
    }
  }

  return (
    <section className="dashboard-page admin-page">
      <div className="page-heading">
        <p className="eyebrow">واجهة الإدارة</p>
        <h1>لوحة تحكم المنصة</h1>
        <p>اعتماد المخازن، إدارة العمولات، مراجعة الكتالوج، ومراقبة جودة المطابقة.</p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {isLoading ? <Card>جار تحميل بيانات الإدارة...</Card> : null}

      <div className="summary-grid">
        <Card>
          <Warehouse className="card-icon" />
          <span className="metric-value">{stats?.active_warehouses ?? 0}</span>
          <p>مخازن نشطة</p>
        </Card>
        <Card>
          <ShieldCheck className="card-icon" />
          <span className="metric-value">{stats?.orders_count ?? 0}</span>
          <p>عدد الطلبات</p>
        </Card>
        <Card>
          <BadgePercent className="card-icon" />
          <span className="metric-value">{formatMoney(stats?.total_commission_due ?? 0)}</span>
          <p>عمولة مستحقة</p>
        </Card>
      </div>

      <Card className="admin-section">
        <div className="section-head">
          <h2>اعتماد المخازن</h2>
          <p>{pendingWarehouses.length} طلب بانتظار المراجعة</p>
        </div>
        <div className="admin-list">
          {pendingWarehouses.length === 0 ? <p className="muted-line">لا توجد مخازن معلقة.</p> : null}
          {pendingWarehouses.map((warehouseRow) => (
            <div className="admin-row" key={warehouseRow.id}>
              <div>
                <strong>{warehouseRow.warehouse_name}</strong>
                <p>{warehouseRow.profiles?.full_name ?? '-'} | {warehouseRow.profiles?.phone ?? '-'}</p>
              </div>
              <div className="row-actions">
                <Button onClick={() => void runAdminAction(() => setWarehouseStatus(warehouseRow.id, 'active'), 'تم اعتماد المخزن.')} type="button">
                  <Check size={18} />
                  قبول
                </Button>
                <Button onClick={() => void runAdminAction(() => setWarehouseStatus(warehouseRow.id, 'suspended'), 'تم رفض المخزن.')} type="button" variant="secondary">
                  <X size={18} />
                  رفض
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="admin-section">
        <div className="section-head">
          <h2>إدارة العمولات</h2>
          <p>النسبة العامة الحالية: {globalCommission?.commission_pct ?? 5}%</p>
        </div>
        <div className="commission-form">
          <label>
            <span>النسبة العامة</span>
            <input min="0" max="100" onChange={(event) => setGlobalRate(event.target.value)} step="0.1" type="number" value={globalRate} />
          </label>
          <Button onClick={() => void runAdminAction(() => setCommissionRate(null, Number(globalRate)), 'تم تحديث العمولة العامة.')} type="button">
            حفظ العام
          </Button>
        </div>
        <div className="commission-form">
          <label>
            <span>مخزن محدد</span>
            <select onChange={(event) => setSpecificWarehouseId(event.target.value)} value={specificWarehouseId}>
              <option value="">اختر مخزن</option>
              {warehouses.map((warehouseRow) => (
                <option key={warehouseRow.id} value={warehouseRow.id}>{warehouseRow.warehouse_name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>النسبة الخاصة</span>
            <input min="0" max="100" onChange={(event) => setSpecificRate(event.target.value)} step="0.1" type="number" value={specificRate} />
          </label>
          <Button
            disabled={!specificWarehouseId}
            onClick={() => void runAdminAction(() => setCommissionRate(specificWarehouseId, Number(specificRate)), 'تم تحديث عمولة المخزن.')}
            type="button"
          >
            حفظ الخاص
          </Button>
        </div>
        <div className="compact-table">
          {commissionRows.map((row) => (
            <div key={row.id}>
              <span>{row.warehouse_id ? row.warehouses?.warehouse_name ?? 'مخزن' : 'النسبة العامة'}</span>
              <strong>{row.commission_pct}%</strong>
            </div>
          ))}
        </div>
      </Card>

      <Card className="admin-section">
        <div className="section-head">
          <h2>مراجعة الكتالوج</h2>
          <p>تعديل الأكواد، التحقق، ودمج المنتجات المكررة.</p>
        </div>
        <div className="catalog-list">
          {products.map((product) => {
            const draft = productDrafts[product.id] ?? { productCode: product.product_code, isVerified: product.is_verified }
            return (
              <div className="catalog-row" key={product.id}>
                <div>
                  <strong>{product.canonical_name}</strong>
                  <p>{product.normalized_key}</p>
                </div>
                <input
                  aria-label="كود المنتج"
                  onChange={(event) =>
                    setProductDrafts((current) => ({
                      ...current,
                      [product.id]: { ...draft, productCode: event.target.value },
                    }))
                  }
                  value={draft.productCode}
                />
                <label className="inline-check">
                  <input
                    checked={draft.isVerified}
                    onChange={(event) =>
                      setProductDrafts((current) => ({
                        ...current,
                        [product.id]: { ...draft, isVerified: event.target.checked },
                      }))
                    }
                    type="checkbox"
                  />
                  موثق
                </label>
                <Button
                  onClick={() => void runAdminAction(() => updateProduct(product.id, draft.productCode, draft.isVerified), 'تم تحديث المنتج.')}
                  type="button"
                  variant="ghost"
                >
                  حفظ
                </Button>
                <select
                  aria-label="منتج الدمج الهدف"
                  onChange={(event) => setTargetBySource((current) => ({ ...current, [product.id]: event.target.value }))}
                  value={targetBySource[product.id] ?? ''}
                >
                  <option value="">دمج داخل...</option>
                  {products.filter((target) => target.id !== product.id).map((target) => (
                    <option key={target.id} value={target.id}>{target.product_code} | {target.canonical_name}</option>
                  ))}
                </select>
                <Button
                  disabled={!targetBySource[product.id]}
                  onClick={() => void runAdminAction(() => mergeProducts(product.id, targetBySource[product.id]), 'تم دمج المنتج.')}
                  type="button"
                  variant="secondary"
                >
                  <GitMerge size={18} />
                  دمج
                </Button>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="admin-section">
        <div className="section-head">
          <h2>صحة المطابقة</h2>
          <p>معدلات المطابقة عبر آخر عمليات الاستيراد.</p>
        </div>
        <div className="metrics-list">
          {metrics.map((metric) => (
            <div className="metric-row" key={metric.id}>
              <div>
                <strong>{metric.warehouses?.warehouse_name ?? 'مخزن'}</strong>
                <p>{new Date(metric.created_at).toLocaleString('ar-EG')}</p>
              </div>
              <span>تلقائي {rate(metric, 'auto_count')}%</span>
              <span>مراجعة {rate(metric, 'review_count')}%</span>
              <span>جديد {rate(metric, 'new_count')}%</span>
              <span>تصحيحات {metric.corrected_count}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}
