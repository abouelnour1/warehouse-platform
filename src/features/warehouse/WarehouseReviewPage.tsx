import { Clock3 } from 'lucide-react'

import { Card } from '../../components'
import { useAuth } from '../auth/useAuth'

export function WarehouseReviewPage() {
  const { account } = useAuth()
  const status = account?.warehouse?.status ?? 'pending'

  return (
    <section className="dashboard-page narrow-page">
      <Card className="review-card">
        <Clock3 className="review-icon" />
        <p className="eyebrow">حساب قيد المراجعة</p>
        <h1>{account?.warehouse?.warehouse_name ?? 'حساب المخزن'}</h1>
        <p>
          تم استلام بيانات المخزن. سيتم فتح لوحة التحكم بعد اعتماد الحساب من الإدارة.
        </p>
        <span className="status-pill">الحالة الحالية: {status === 'suspended' ? 'موقوف' : 'بانتظار الاعتماد'}</span>
      </Card>
    </section>
  )
}
