// App-level service worker: makes the app installable + offline-capable.
// Separate from the folder-sync SW (which lives at /folder-sync/ scope and
// handles cloud sync). This one's scope is the app root (/).
//
// Strategy:
//   - Stale-while-revalidate for same-origin GETs.
//   - Navigation requests fall back to cached index.html when offline.
//   - Folder-sync paths are NOT intercepted (the other SW owns them).

const CACHE = 'mealjot-app-v2'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // Evict any prior caches (e.g. food-tracker-app-v1, mealjot-app-v1) so
  // users always get the latest bundle instead of a stale UI.
  const keys = await caches.keys()
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  await self.clients.claim()
})()))

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

function isFolderSyncScope(url) {
  return url.pathname.includes('/folder-sync/')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (isFolderSyncScope(url)) return

  // Navigation: try network, fall back to cached app shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(CACHE)
          cache.put(req, fresh.clone()).catch(() => {})
          return fresh
        } catch {
          const cache = await caches.open(CACHE)
          // Try the exact URL first, then the scope root (SPA fallback).
          const cached = await cache.match(req) || await cache.match(new URL('./', self.location).toString())
          return cached || new Response('Offline', { status: 503 })
        }
      })()
    )
    return
  }

  // Other GETs: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(req)
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
          return res
        })
        .catch(() => cached)
      return cached || fetchPromise
    })()
  )
})
