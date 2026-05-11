import { supabase } from './supabase'

// Drop-in replacement for the window.storage API used in the artifact.
// Keys are scoped per user automatically via Supabase RLS policies.

export const store = {
  async get(key) {
    try {
      const { data, error } = await supabase
        .from('user_data')
        .select('value')
        .eq('key', key)
        .maybeSingle()
      if (error) throw error
      return data?.value ?? null
    } catch (e) {
      console.error('store.get error', e)
      return null
    }
  },

  async set(key, value) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('user_data')
        .upsert({ user_id: user.id, key, value, updated_at: new Date().toISOString() },
                 { onConflict: 'user_id,key' })
      if (error) throw error
    } catch (e) {
      console.error('store.set error', e)
    }
  },

  async list(prefix) {
    try {
      const { data, error } = await supabase
        .from('user_data')
        .select('key')
        .like('key', `${prefix}%`)
      if (error) throw error
      return data?.map(r => r.key) ?? []
    } catch (e) {
      console.error('store.list error', e)
      return []
    }
  },
}
