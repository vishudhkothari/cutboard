import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
// Local/demo mode never calls auth or account persistence. Keep module import safe
// when the optional backend has not been configured.
export const supabase = createClient(url || 'https://demo.invalid', key || 'demo-anon-key')
