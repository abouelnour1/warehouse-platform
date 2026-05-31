import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'

import { supabase } from '../supabase'
import type { Profile, UserAccount, UserRole, WarehouseStatus } from '../../types'
import { loadUserAccount, signOut as supabaseSignOut } from '../../features/auth/authService'

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface AuthContextValue {
  // ── Primary fields ──────────────────────────────────────────────────────
  session: Session | null
  profile: Profile | null
  role: UserRole | null
  /** Populated only when role === 'warehouse'; null otherwise. */
  warehouseStatus: WarehouseStatus | null
  /** True until both session and profile have finished resolving. */
  loading: boolean
  /** Set when a session exists but the profile row could not be loaded. */
  error: string | null
  signOut: () => Promise<void>
  /** Re-fetch session + profile without triggering a full sign-out/sign-in. */
  refresh: () => Promise<void>

  // ── Backward-compat aliases (removed once every consumer migrates) ───────
  account: UserAccount | null
  isLoading: boolean
  refreshAccount: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Context + hook
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [account, setAccount] = useState<UserAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadForSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession)
    setError(null)

    if (!nextSession?.user) {
      setAccount(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const loaded = await loadUserAccount(nextSession.user.id)
      if (loaded === null) {
        // Session exists but profile row is absent — likely a failed signup.
        setAccount(null)
        setError('لم يتم العثور على بيانات الحساب. تواصل مع الدعم.')
        // DIAG-2a: profile row missing after successful auth
        console.warn('[auth] profile row not found for uid=', nextSession.user.id)
      } else {
        setAccount(loaded)
        // DIAG-2b: happy path — confirm role is populated
        console.log('[auth] profile loaded — role=', loaded.profile.role, 'warehouseStatus=', loaded.warehouse?.status ?? null)
      }
    } catch (err) {
      setAccount(null)
      setError(err instanceof Error ? err.message : 'فشل تحميل بيانات الحساب')
      // DIAG-2c: fetch threw — most likely an RLS / grant error
      console.error('[auth] loadUserAccount threw:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Supabase v2 fires INITIAL_SESSION through onAuthStateChange automatically
  // when the subscription is first set up, covering the cold-start case.
  // Calling getSession() here as well would trigger a second loadForSession
  // concurrently, resulting in two profile fetches on every page load.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // DIAG-1: confirms the event fires and whether a session arrived
      console.log('[auth] onAuthStateChange', _event, 'hasSession=', !!nextSession)
      void loadForSession(nextSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [loadForSession])

  const refresh = useCallback(async () => {
    await loadForSession(session)
  }, [loadForSession, session])

  const signOut = useCallback(async () => {
    await supabaseSignOut()
    // onAuthStateChange fires SIGNED_OUT → loadForSession(null) clears state.
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile: account?.profile ?? null,
      role: account?.profile.role ?? null,
      warehouseStatus: account?.warehouse?.status ?? null,
      loading,
      error,
      signOut,
      refresh,
      // Backward-compat
      account,
      isLoading: loading,
      refreshAccount: refresh,
    }),
    [session, account, loading, error, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
