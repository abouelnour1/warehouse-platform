import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'

import { Button, Card, Field } from '../../components'
import { AuthLayout } from './AuthLayout'
import { getAuthMessage, signInWithPassword } from './authService'
import { useAuth } from './useAuth'

export function SignInPage() {
  const { session, role } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reactive redirect: once AuthProvider has session + role, leave /signin.
  // This fires on the re-render triggered by onAuthStateChange completing,
  // which avoids the race where RoleRedirect sees stale state and bounces
  // back to /signin before the profile fetch finishes.
  if (session && role) {
    return <Navigate replace to="/" />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      await signInWithPassword(email, password)
      // onAuthStateChange will fire, loadForSession will run, and once
      // session + role are in state the reactive redirect above takes over.
    } catch (err) {
      setError(getAuthMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <Card className="auth-card">
        <div className="form-heading">
          <h2>تسجيل الدخول</h2>
          <p>ادخل إلى حسابك لمتابعة الطلبات والعروض.</p>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
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
            autoComplete="current-password"
            label="كلمة المرور"
            name="password"
            onChange={(e) => setPassword(e.target.value)}
            required
            type="password"
            value={password}
          />

          {error ? <p className="form-error">{error}</p> : null}

          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'جار الدخول...' : 'تسجيل الدخول'}
          </Button>
        </form>

        <p className="auth-switch">
          ليس لديك حساب؟ <Link to="/signup">إنشاء حساب جديد</Link>
        </p>
      </Card>
    </AuthLayout>
  )
}
