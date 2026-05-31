import { Clock3 } from 'lucide-react'

import { Button, Card } from '../../components'
import { useAuth } from '../auth/useAuth'

export function WarehousePendingPage() {
  const { account, profile, signOut } = useAuth()

  const displayName =
    account?.warehouse?.warehouse_name ??
    profile?.full_name ??
    'حساب المخزن'

  return (
    <main className="app-shell loading-screen">
      <section className="dashboard-page narrow-page">
        <Card className="review-card">
          <Clock3 className="review-icon" />
          <p className="eyebrow">حساب قيد المراجعة</p>
          <h1>{displayName}</h1>
          <p>تم استلام بيانات المخزن. سيتم فتح لوحة التحكم بعد اعتماد الحساب من الإدارة.</p>
          <span className="status-pill">الحالة الحالية: بانتظار الاعتماد</span>
          <Button onClick={() => void signOut()} type="button" variant="ghost">
            تسجيل الخروج
          </Button>
        </Card>
      </section>
    </main>
  )
}
