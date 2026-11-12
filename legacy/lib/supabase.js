import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const DEMO = import.meta.env.VITE_DEMO === '1'

if ((!url || !key) && !DEMO) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

// In demo builds (or when env is absent) fall back to a harmless placeholder so
// module import never throws — the demo store/session are used instead.
export const supabase = createClient(url || 'https://demo.invalid', key || 'demo-anon-key')
