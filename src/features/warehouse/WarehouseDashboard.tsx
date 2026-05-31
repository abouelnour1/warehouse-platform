import { ClipboardList, FileSpreadsheet, PackageCheck, SearchCheck } from 'lucide-react'
import { Link } from 'react-router'

import { Card } from '../../components'
import { useAuth } from '../auth/useAuth'

export function WarehouseDashboard() {
  const { account } = useAuth()

  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <p className="eyebrow">واجهة المخزن</p>
        <h1>{account?.warehouse?.warehouse_name ?? 'المخزن'}</h1>
        <p>إدارة الأسعار والمخزون والطلبات الواردة بعد اعتماد الحساب.</p>
      </div>

      <div className="dashboard-grid">
        <Card>
          <FileSpreadsheet className="card-icon" />
          <h2>رفع ملف الأسعار</h2>
          <p>ارفع ملف Excel ليتم تحليل الأسعار والمخزون ومطابقة الأصناف.</p>
          <Link className="card-link" to="/warehouse/import">فتح الاستيراد</Link>
        </Card>
        <Card>
          <ClipboardList className="card-icon" />
          <h2>الطلبات الواردة</h2>
          <p>قبول الطلبات وتحريكها حتى الشحن والتسليم.</p>
          <Link className="card-link" to="/warehouse/orders">فتح الطلبات</Link>
        </Card>
        <Card>
          <SearchCheck className="card-icon" />
          <h2>مراجعة المطابقة</h2>
          <p>تأكيد الأصناف المشكوك فيها قبل ربطها بالكتالوج.</p>
          <Link className="card-link" to="/warehouse/reviews">مراجعة الأصناف</Link>
        </Card>
        <Card>
          <PackageCheck className="card-icon" />
          <h2>العروض النشطة</h2>
          <p>مراجعة الأسعار والمخزون المتاح للصيدليات والتعديل السريع.</p>
          <Link className="card-link" to="/warehouse/products">إدارة منتجاتي</Link>
        </Card>
      </div>
    </section>
  )
}
