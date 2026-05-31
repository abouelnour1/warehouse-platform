import { Download, FileSpreadsheet, UploadCloud } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'

import { Button, Card } from '../../components'
import { getAuthMessage } from '../auth/authService'
import { importPriceFile, type ImportSummary } from './warehouseService'

export function WarehouseImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [error, setError] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null)
    setSummary(null)
    setError('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return

    setError('')
    setSummary(null)
    setProgress(12)
    setIsUploading(true)

    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(value + 12, 88))
    }, 350)

    try {
      const result = await importPriceFile(file)
      setSummary(result.summary)
      setProgress(100)
    } catch (err) {
      setError(getAuthMessage(err))
      setProgress(0)
    } finally {
      window.clearInterval(timer)
      setIsUploading(false)
    }
  }

  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <p className="eyebrow">رفع الأسعار</p>
        <h1>استيراد ملف Excel</h1>
        <p>ارفع ملف الأسعار والمخزون، وسيقوم الخادم بالمطابقة وإنشاء العروض.</p>
      </div>

      <Card className="upload-card">
        <form className="stack" onSubmit={handleSubmit}>
          <label className="upload-drop">
            <FileSpreadsheet size={34} />
            <span>{file ? file.name : 'اختر ملف Excel بصيغة xlsx'}</span>
            <input accept=".xlsx,.xls" onChange={handleFileChange} type="file" />
          </label>

          <div className="progress-track" aria-label="نسبة الرفع">
            <span style={{ inlineSize: `${progress}%` }} />
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          <div className="actions-row">
            <Button disabled={!file || isUploading} type="submit">
              <UploadCloud size={18} />
              {isUploading ? 'جار المعالجة...' : 'رفع ومعالجة الملف'}
            </Button>
            <a className="button button-secondary" download href="/templates/warehouse-price-template.xls">
              <Download size={18} />
              تحميل القالب الرسمي
            </a>
          </div>
        </form>
      </Card>

      {summary ? (
        <div className="summary-grid">
          <Card>
            <span className="metric-value">{summary.autoCount}</span>
            <p>مطابقة تلقائية</p>
          </Card>
          <Card>
            <span className="metric-value">{summary.reviewCount}</span>
            <p>تحتاج مراجعة</p>
          </Card>
          <Card>
            <span className="metric-value">{summary.newCount}</span>
            <p>منتجات جديدة</p>
          </Card>
          <Card>
            <span className="metric-value">{summary.skippedCount}</span>
            <p>صفوف متجاهلة</p>
          </Card>
        </div>
      ) : null}
    </section>
  )
}
