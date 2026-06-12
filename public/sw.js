/* Cutboard service worker — deliberately minimal.
   Strategy:
   - Navigations: NETWORK FIRST (so a new deploy is never stuck behind a
     stale cached index.html), falling back to cache when offline.
   - Hashed build assets (/assets/*): cache-first — their names change
     every build, so they are immutable by construction.
   Data (Supabase) is never intercepted. */
const CACHE = 'cutboard-v1'

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/'])))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => { caches.open(CACHE).then(c => c.put('/', r.clone())); return r })
        .catch(() => caches.match('/'))
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.match(/\.(png|svg|webmanifest)$/)) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const hit = await c.match(e.request)
        if (hit) return hit
        const r = await fetch(e.request)
        if (r.ok) c.put(e.request, r.clone())
        return r
      })
    )
  }
})
