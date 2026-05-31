import { ShieldOff } from 'lucide-react'

import { Button, Card } from '../../components'
import { useAuth } from '../auth/useAuth'

export function WarehouseSuspendedPage() {
  const { account, profile, signOut } = useAuth()

  const displayName =
    account?.warehouse?.warehouse_name ??
    profile?.full_name ??
    'حساب المخزن'

  return (
    <main className="app-shell loading-screen">
      <section className="dashboard-page narrow-page">
        <Card className="review-card">
          <ShieldOff className="review-icon" />
          <p className="eyebrow">حساب موقوف</p>
          <h1>{displayName}</h1>
          <p>تم إيقاف هذا الحساب. تواصل مع إدارة المنصة لمعرفة السبب وإعادة التفعيل.</p>
          <span className="status-pill">الحالة الحالية: موقوف</span>
          <Button onClick={() => void signOut()} type="button" variant="ghost">
            تسجيل الخروج
          </Button>
        </Card>
      </section>
    </main>
  )
}
