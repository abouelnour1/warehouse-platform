import { Building2, Store } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { Button, Card, Field } from '../../components'
import type { UserRole } from '../../types'
import { useAuth } from './useAuth'
import { AuthLayout } from './AuthLayout'
import { getAuthMessage, signUpAccount } from './authService'

type SignUpRole = Exclude<UserRole, 'admin'>

export function SignUpPage() {
  const navigate = useNavigate()
  const { refresh } = useAuth()

  const [role, setRole] = useState<SignUpRole>('pharmacy')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [licenseNo, setLicenseNo] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSubmitting(true)

    try {
      const user = await signUpAccount({
        role,
        email,
        password,
        fullName,
        phone,
        organizationName,
        licenseNo,
        address,
        city,
      })

      if (!user) {
        // Supabase requires email confirmation — session not yet established.
        setMessage('تم إنشاء الحساب. راجع بريدك الإلكتروني لتأكيد التسجيل.')
        return
      }

      // onAuthStateChange fires the moment signUp establishes a session, which
      // can race with the pharmacies/warehouses INSERT above. Awaiting refresh()
      // here guarantees the role-specific row exists before we navigate.
      await refresh()

      // RoleRedirect at "/" decides the destination:
      //   pharmacy  → /app
      //   warehouse → /warehouse/pending  (status = pending by default)
      navigate('/', { replace: true })
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <Card className="auth-card auth-card-wide">
        <div className="form-heading">
          <h2>إنشاء حساب</h2>
          <p>اختر نوع الحساب وأكمل بيانات التسجيل الأساسية.</p>
        </div>

        <div className="role-selector" aria-label="نوع الحساب">
          <button
            className={role === 'pharmacy' ? 'role-option active' : 'role-option'}
            onClick={() => setRole('pharmacy')}
            type="button"
          >
            <Store size={20} />
            صيدلية
          </button>
          <button
            className={role === 'warehouse' ? 'role-option active' : 'role-option'}
            onClick={() => setRole('warehouse')}
            type="button"
          >
            <Building2 size={20} />
            مخزن
          </button>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field
              label="الاسم الكامل"
              name="fullName"
              onChange={(e) => setFullName(e.target.value)}
              required
              value={fullName}
            />
            <Field
              label="رقم الهاتف"
              name="phone"
              onChange={(e) => setPhone(e.target.value)}
              required
              type="tel"
              value={phone}
            />
            <Field
              autoComplete="email"
              label="البريد الإلكتروني"
              name="email"
              onChange={(e) => setEmail(e.target.value)}
              required
              type="email"
              value={email}
            />
            <Field
              autoComplete="new-password"
              label="كلمة المرور"
              minLength={6}
              name="password"
              onChange={(e) => setPassword(e.target.value)}
              required
              type="password"
              value={password}
            />
            <Field
              label={role === 'pharmacy' ? 'اسم الصيدلية' : 'اسم المخزن'}
              name="organizationName"
              onChange={(e) => setOrganizationName(e.target.value)}
              required
              value={organizationName}
            />
            <Field
              label={role === 'pharmacy' ? 'رقم الترخيص' : 'رقم السجل / الترخيص'}
              name="licenseNo"
              onChange={(e) => setLicenseNo(e.target.value)}
              required={role === 'pharmacy'}
              value={licenseNo}
            />
            <Field
              label="المدينة"
              name="city"
              onChange={(e) => setCity(e.target.value)}
              required
              value={city}
            />
            <Field
              label="العنوان"
              name="address"
              onChange={(e) => setAddress(e.target.value)}
              value={address}
            />
          </div>

          {error   ? <p className="form-error">{error}</p>     : null}
          {message ? <p className="form-success">{message}</p> : null}

          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'جار إنشاء الحساب...' : 'إنشاء الحساب'}
          </Button>
        </form>

        <p className="auth-switch">
          لديك حساب؟ <Link to="/signin">تسجيل الدخول</Link>
        </p>
      </Card>
    </AuthLayout>
  )
}
