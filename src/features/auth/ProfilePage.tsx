import { useState, type FormEvent } from 'react'

import { Button, Card, Field } from '../../components'
import type { UserAccount } from '../../types'
import { getAuthMessage, updateUserAccount } from './authService'
import { useAuth } from './useAuth'

export function ProfilePage() {
  const { account, refreshAccount } = useAuth()

  if (!account) return null

  return <ProfileForm account={account} refreshAccount={refreshAccount} />
}

interface ProfileFormProps {
  account: UserAccount
  refreshAccount: () => Promise<void>
}

function ProfileForm({ account, refreshAccount }: ProfileFormProps) {
  const [fullName, setFullName] = useState(account.profile.full_name)
  const [phone, setPhone] = useState(account.profile.phone ?? '')
  const [organizationName, setOrganizationName] = useState(
    account.pharmacy?.pharmacy_name ?? account.warehouse?.warehouse_name ?? '',
  )
  const [licenseNo, setLicenseNo] = useState(account.pharmacy?.license_no ?? '')
  const [address, setAddress] = useState(account.pharmacy?.address ?? '')
  const [city, setCity] = useState(account.pharmacy?.city ?? account.warehouse?.delivery_areas[0] ?? '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setMessage('')
    setIsSubmitting(true)

    try {
      await updateUserAccount(account, {
        fullName,
        phone,
        organizationName,
        licenseNo,
        address,
        city,
      })
      await refreshAccount()
      setMessage('تم حفظ البيانات.')
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const organizationLabel = account.profile.role === 'warehouse' ? 'اسم المخزن' : 'اسم الصيدلية'

  return (
    <section className="dashboard-page narrow-page">
      <Card className="profile-card">
        <div className="form-heading">
          <p className="eyebrow">الملف الشخصي</p>
          <h1>بيانات الحساب</h1>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="الاسم الكامل" name="fullName" onChange={(event) => setFullName(event.target.value)} required value={fullName} />
            <Field label="رقم الهاتف" name="phone" onChange={(event) => setPhone(event.target.value)} value={phone} />
            {account.profile.role !== 'admin' ? (
              <Field label={organizationLabel} name="organizationName" onChange={(event) => setOrganizationName(event.target.value)} required value={organizationName} />
            ) : null}
            {account.profile.role === 'pharmacy' ? (
              <>
                <Field label="رقم الترخيص" name="licenseNo" onChange={(event) => setLicenseNo(event.target.value)} required value={licenseNo} />
                <Field label="المدينة" name="city" onChange={(event) => setCity(event.target.value)} value={city} />
                <Field label="العنوان" name="address" onChange={(event) => setAddress(event.target.value)} value={address} />
              </>
            ) : null}
            {account.profile.role === 'warehouse' ? (
              <Field label="مدينة التغطية الأساسية" name="city" onChange={(event) => setCity(event.target.value)} value={city} />
            ) : null}
          </div>

          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}

          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'جار الحفظ...' : 'حفظ التغييرات'}
          </Button>
        </form>
      </Card>
    </section>
  )
}
