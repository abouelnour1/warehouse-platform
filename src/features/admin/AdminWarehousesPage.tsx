import { Check, Warehouse, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button, Card } from '../../components'
import { getAuthMessage } from '../auth/authService'
import { loadAdminWarehouses, setWarehouseStatus, type AdminWarehouse } from './adminService'

const statusLabels: Record<AdminWarehouse['status'], string> = {
  pending: 'قيد المراجعة',
  active: 'نشط',
  suspended: 'موقوف',
}

function formatDate(value: string | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(value))
}

export function AdminWarehousesPage() {
  const [warehouses, setWarehouses] = useState<AdminWarehouse[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadWarehouses = useCallback(async () => {
    setError('')
    setIsLoading(true)
    try {
      setWarehouses(await loadAdminWarehouses())
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadWarehouses(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadWarehouses])

  async function changeStatus(warehouse: AdminWarehouse, status: 'active' | 'suspended') {
    setBusyId(warehouse.id)
    setError('')
    setMessage('')
    try {
      await setWarehouseStatus(warehouse.id, status)
      setMessage(status === 'active' ? 'تم اعتماد المخزن.' : 'تم إيقاف المخزن.')
      await loadWarehouses()
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
        <h1>المخازن</h1>
        <p>مراجعة المخازن المسجّلة وإدارة حالاتها. تظهر الطلبات الجديدة أولا.</p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {isLoading ? <Card>جار تحميل المخازن...</Card> : null}

      {!isLoading && warehouses.length === 0 ? (
        <Card className="empty-state">
          <Warehouse size={28} />
          <h2>لا توجد مخازن مسجّلة</h2>
          <p>ستظهر طلبات تسجيل المخازن هنا عند إنشائها.</p>
        </Card>
      ) : null}

      <div className="admin-table-list">
        {warehouses.map((warehouse) => (
          <Card className="admin-warehouse-card" key={warehouse.id}>
            <div>
              <strong>{warehouse.warehouse_name}</strong>
              <p>{warehouse.profiles?.full_name ?? '-'}</p>
            </div>
            <div>
              <span className="admin-cell-label">تاريخ التسجيل</span>
              <strong>{formatDate(warehouse.profiles?.created_at)}</strong>
            </div>
            <span className={`order-status status-${warehouse.status}`}>{statusLabels[warehouse.status]}</span>
            <div className="row-actions">
              {warehouse.status === 'pending' ? (
                <>
                  <Button disabled={busyId === warehouse.id} onClick={() => void changeStatus(warehouse, 'active')} type="button">
                    <Check size={18} />
                    اعتماد
                  </Button>
                  <Button disabled={busyId === warehouse.id} onClick={() => void changeStatus(warehouse, 'suspended')} type="button" variant="secondary">
                    <X size={18} />
                    رفض
                  </Button>
                </>
              ) : null}
              {warehouse.status === 'active' ? (
                <Button disabled={busyId === warehouse.id} onClick={() => void changeStatus(warehouse, 'suspended')} type="button" variant="ghost">
                  إيقاف
                </Button>
              ) : null}
              {warehouse.status === 'suspended' ? (
                <Button disabled={busyId === warehouse.id} onClick={() => void changeStatus(warehouse, 'active')} type="button" variant="ghost">
                  إعادة التفعيل
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
