import { supabase } from './supabase'
import { DEMO, demoStore } from './demo'

// Drop-in replacement for the window.storage API used in the artifact.
// Keys are scoped per user automatically via Supabase RLS policies.

const realStore = {
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

  // Fetch every value whose key matches a prefix in ONE round-trip.
  // Replaces the list()+N×get() pattern that fired a query per log day.
  async getByPrefix(prefix) {
    try {
      const { data, error } = await supabase
        .from('user_data')
        .select('value')
        .like('key', `${prefix}%`)
      if (error) throw error
      return (data ?? []).map(r => r.value).filter(Boolean)
    } catch (e) {
      console.error('store.getByPrefix error', e)
      return []
    }
  },

  async clearAll() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('user_data')
        .delete()
        .eq('user_id', user.id)
      if (error) throw error
      return true
    } catch (e) {
      console.error('store.clearAll error', e)
      return false
    }
  },

  // ── Shared custom foods (visible to ALL users) ──
  async getSharedFoods() {
    try {
      const { data, error } = await supabase
        .from('shared_foods')
        .select('food')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data?.map(r => r.food) ?? []
    } catch (e) {
      console.error('store.getSharedFoods error', e)
      return []
    }
  },

  async addSharedFood(food) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('shared_foods')
        .upsert({ id: food.id, food, created_by: user.id }, { onConflict: 'id' })
      if (error) throw error
      return true
    } catch (e) {
      console.error('store.addSharedFood error', e)
      return false
    }
  },

  // ── Progress photos (private per-user storage bucket) ──
  async uploadPhoto(blob, dateStr) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const path = `${user.id}/${dateStr}_${Date.now()}.jpg`
      const { error } = await supabase.storage
        .from('progress-photos')
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      return path
    } catch (e) {
      console.error('store.uploadPhoto error', e)
      return null
    }
  },

  async listPhotos() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.storage
        .from('progress-photos')
        .list(user.id, { sortBy: { column: 'name', order: 'asc' } })
      if (error) throw error
      return (data ?? []).filter(f => f.name).map(f => `${user.id}/${f.name}`)
    } catch (e) {
      console.error('store.listPhotos error', e)
      return []
    }
  },

  async photoUrl(path) {
    try {
      const { data, error } = await supabase.storage
        .from('progress-photos')
        .createSignedUrl(path, 3600)
      if (error) throw error
      return data.signedUrl
    } catch (e) {
      console.error('store.photoUrl error', e)
      return null
    }
  },

  async deletePhoto(path) {
    try {
      const { error } = await supabase.storage.from('progress-photos').remove([path])
      if (error) throw error
      return true
    } catch (e) {
      console.error('store.deletePhoto error', e)
      return false
    }
  },
}

// Demo builds (VITE_DEMO=1) swap in an in-memory seeded store; production is untouched.
export const store = DEMO ? demoStore : realStore
