import type { AuthError, User } from '@supabase/supabase-js'

import { supabase } from '../../lib/supabase'
import type { Pharmacy, Profile, UserAccount, UserRole, Warehouse } from '../../types'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface SignUpInput {
  role: Exclude<UserRole, 'admin'>
  email: string
  password: string
  fullName: string
  phone: string
  organizationName: string
  licenseNo: string
  address: string
  city: string
}

export interface ProfileUpdateInput {
  fullName: string
  phone: string
  organizationName: string
  licenseNo?: string
  address?: string
  city?: string
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/**
 * Creates a new user account.
 *
 * Returns null when Supabase requires email confirmation (no immediate session).
 * In that case the handle_new_user trigger has already created the profiles row,
 * but the role-specific row (pharmacies / warehouses) cannot be created until the
 * user confirms and signs in.
 *
 * Returns the User object on immediate sign-in (email confirmation disabled),
 * after which the profile and role-specific rows are upserted / inserted.
 */
export async function signUpAccount(input: SignUpInput): Promise<User | null> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        // Stored in auth.users.raw_user_meta_data.
        // The handle_new_user trigger reads these to create the profiles row.
        full_name: input.fullName,
        role: input.role,
      },
    },
  })

  if (error) throw error

  // No session means Supabase requires email confirmation.
  // The trigger has already created the profiles row; the role-specific row
  // will need to be created on first sign-in after confirmation.
  if (!data.session || !data.user) return null

  const userId = data.user.id

  // Upsert profiles (trigger already ran, but we set phone which the trigger leaves null)
  const { error: profileErr } = await supabase
    .from('profiles')
    .upsert(
      { id: userId, role: input.role, full_name: input.fullName, phone: input.phone || null },
      { onConflict: 'id' },
    )
  if (profileErr) throw profileErr

  if (input.role === 'pharmacy') {
    const { error: pharmacyErr } = await supabase.from('pharmacies').insert({
      id: userId,
      pharmacy_name: input.organizationName,
      license_no: input.licenseNo,
      address: input.address || null,
      city: input.city || null,
    })
    if (pharmacyErr) throw pharmacyErr
  } else {
    // status defaults to 'pending' in the DB schema
    const { error: warehouseErr } = await supabase.from('warehouses').insert({
      id: userId,
      warehouse_name: input.organizationName,
      delivery_areas: input.city ? [input.city] : [],
    })
    if (warehouseErr) throw warehouseErr
  }

  return data.user
}

// ---------------------------------------------------------------------------
// Account loading
// ---------------------------------------------------------------------------

export async function loadUserAccount(userId: string): Promise<UserAccount | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, full_name, phone, created_at')
    .eq('id', userId)
    .maybeSingle<Profile>()

  if (profileError) throw profileError
  if (!profile) return null

  let pharmacy: Pharmacy | null = null
  let warehouse: Warehouse | null = null

  if (profile.role === 'pharmacy') {
    const { data, error } = await supabase
      .from('pharmacies')
      .select('id, pharmacy_name, license_no, address, city, lat, lng')
      .eq('id', userId)
      .maybeSingle<Pharmacy>()
    if (error) throw error
    pharmacy = data
  }

  if (profile.role === 'warehouse') {
    const { data, error } = await supabase
      .from('warehouses')
      .select('id, warehouse_name, status, min_order_value, delivery_areas, last_price_update, is_deleted')
      .eq('id', userId)
      .maybeSingle<Warehouse>()
    if (error) throw error
    warehouse = data
  }

  return { profile, pharmacy, warehouse }
}

// ---------------------------------------------------------------------------
// Account updates
// ---------------------------------------------------------------------------

export async function updateUserAccount(account: UserAccount, input: ProfileUpdateInput): Promise<void> {
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: input.fullName, phone: input.phone || null })
    .eq('id', account.profile.id)
  if (profileError) throw profileError

  if (account.profile.role === 'pharmacy') {
    const { error } = await supabase
      .from('pharmacies')
      .update({
        pharmacy_name: input.organizationName,
        license_no: input.licenseNo ?? '',
        address: input.address || null,
        city: input.city || null,
      })
      .eq('id', account.profile.id)
    if (error) throw error
  }

  if (account.profile.role === 'warehouse') {
    const { error } = await supabase
      .from('warehouses')
      .update({
        warehouse_name: input.organizationName,
        delivery_areas: input.city ? [input.city] : [],
      })
      .eq('id', account.profile.id)
    if (error) throw error
  }
}

// ---------------------------------------------------------------------------
// Error messages (Arabic)
// ---------------------------------------------------------------------------

const ERROR_MAP: [RegExp, string][] = [
  [/already registered|user already/i,          'البريد الإلكتروني مسجّل بالفعل. جرّب تسجيل الدخول.'],
  [/invalid.{0,20}credentials|wrong password/i,  'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
  [/email not confirmed/i,                        'يرجى تأكيد البريد الإلكتروني أولاً.'],
  [/password.{0,30}at least|at least.{0,10}char/i, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'],
  [/invalid.{0,20}email|unable to validate email/i, 'البريد الإلكتروني غير صالح.'],
  [/rate.{0,10}limit|too many request/i,          'تجاوزت الحد المسموح من المحاولات. انتظر قليلاً وحاول مجدداً.'],
  [/network|failed to fetch|load failed/i,        'تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.'],
  [/duplicate key|unique constraint/i,            'حدث تعارض في البيانات. تواصل مع الدعم إذا استمرت المشكلة.'],
]

export function getAuthMessage(error: unknown): string {
  const raw =
    (error instanceof Error ? error.message : null) ??
    ((error as Partial<AuthError>).message ?? '')

  for (const [pattern, msg] of ERROR_MAP) {
    if (pattern.test(raw)) return msg
  }

  return raw || 'تعذّر تنفيذ العملية. حاول مرة أخرى.'
}
