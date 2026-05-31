import { Pill } from 'lucide-react'
import type { ReactNode } from 'react'

interface AuthLayoutProps {
  children: ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark" aria-hidden="true">
          <Pill size={30} />
        </div>
        <div>
          <p className="eyebrow">منصة طلبات الصيدليات</p>
          <h1>إدارة الطلبات بين الصيدليات والمخازن من مكان واحد</h1>
        </div>
      </section>
      {children}
    </main>
  )
}
