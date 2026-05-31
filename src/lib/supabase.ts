import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase environment variables are not configured. Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart the dev server.')
}

if (!supabaseUrl.startsWith('https://')) {
  throw new Error('VITE_SUPABASE_URL must be a complete Supabase URL starting with https://.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
