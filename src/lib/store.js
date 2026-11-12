import { supabase } from './supabase'
import { DEMO, demoStore } from './demo'
import { createCloudData } from './cloudData.js'

// Drop-in replacement for the window.storage API used in the artifact.
// Keys are scoped per user automatically via Supabase RLS policies.

const realStore = {
  ...createCloudData(supabase),

  async clearAll({ preserveKeys = [] } = {}) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

      await realStore.drain()
      const preserved = {}
      if (preserveKeys.length) {
        const { data, error: preserveError } = await supabase
          .from('user_data')
          .select('key, value')
          .eq('user_id', user.id)
          .in('key', preserveKeys)
        if (preserveError) throw preserveError
        for (const row of data ?? []) preserved[row.key] = row.value
      }

      const { error } = await supabase
        .from('user_data')
        .delete()
        .eq('user_id', user.id)
      if (error) throw error

      // Progress photos live in Storage rather than user_data, so remove
      // the user's private folder as part of a complete fresh start.
      const { data: photos, error: photoListError } = await supabase.storage
        .from('progress-photos')
        .list(user.id, { limit: 1000 })
      if (photoListError) throw photoListError
      const paths = (photos ?? [])
        .filter(file => file.name)
        .map(file => `${user.id}/${file.name}`)
      if (paths.length) {
        const { error: photoDeleteError } = await supabase.storage
          .from('progress-photos')
          .remove(paths)
        if (photoDeleteError) throw photoDeleteError
      }

      for (const [key, value] of Object.entries(preserved)) {
        const { error: restoreError } = await supabase
          .from('user_data')
          .insert({ user_id: user.id, key, value, updated_at: new Date().toISOString() })
        if (restoreError) throw restoreError
      }

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
