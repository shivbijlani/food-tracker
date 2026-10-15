// Service worker — drains the dirty-file queue and pulls remote changes.
// Registered with `{ type: 'module' }`.  Chromium / latest Firefox / Safari 16+.

import { peekAll, queueRevision, dequeueIfUnchanged } from './queue.js'
import { getTokens } from './auth/tokenStore.js'
import { idbGet, idbSet, idbKeys, idbReplaceIf } from './idb.js'
import { reconcileRecordsFile, isSidecarPath } from './records.js'
import { syncProviderFiles } from './fileSync.js'
import { oneDriveProvider } from './providers/oneDrive.js'
import { googleDriveProvider } from './providers/googleDrive.js'
import { mockProvider } from './providers/mock.js'
import { mergeLogSnapshots } from '../../food-tools/src/logSync.js'

const CHANNEL = 'folder-sync'
const META_STORE = 'meta'

// Files that sync at the record level (per-row merge with tombstones) instead
// of as opaque whole-file blobs, keyed by file name -> codec. This is the same
// machinery the planner uses; food-tracker codecs (monthly entries, recipes,
// systems) plug in here. Until a codec is registered for a file it keeps the
// legacy whole-file last-write-wins path, so behavior is unchanged today.
const RECORD_CODECS = {}

const PROVIDER_FACTORIES = {
  'onedrive': oneDriveProvider,
  'google-drive': googleDriveProvider,
  'mock': mockProvider,
}

let currentProviders = []

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evt) => evt.waitUntil(self.clients.claim()))

self.addEventListener('message', (evt) => {
  const msg = evt.data
  if (!msg) return
  if (msg.type === 'sync') {
    currentProviders = (msg.providers || []).map(p => {
      const factory = PROVIDER_FACTORIES[p.id]
      return factory ? factory({ clientId: p.clientId }) : null
    }).filter(Boolean)
    evt.waitUntil(runSync(msg.reason || 'message'))
  }
})

// Background Sync API
self.addEventListener('sync', (evt) => {
  if (evt.tag === 'folder-sync') evt.waitUntil(runSync('background-sync'))
})
self.addEventListener('periodicsync', (evt) => {
  if (evt.tag === 'folder-sync') evt.waitUntil(runSync('periodic-sync'))
})

let inFlight = null
async function runSync(reason) {
  if (inFlight) return inFlight
  inFlight = (async () => {
    await broadcast({ state: 'syncing', error: null })
    try {
      if (!currentProviders.length) {
        await broadcast({ state: 'idle' })
        return
      }
      if (!self.navigator.onLine) {
        await broadcast({ state: 'offline' })
        return
      }
      const providerStatuses = {}
      const revisions = []
      for (const name of await peekAll()) revisions.push([name, await queueRevision(name)])
      for (const p of currentProviders) {
        try {
          await syncOneProvider(p)
          providerStatuses[p.id] = { connected: true, state: 'synced', error: null }
        } catch (e) {
          const msg = (e && e.message) || String(e)
          if (msg === 'reconnect-required') {
            providerStatuses[p.id] = { connected: false, state: 'reconnect-required', error: msg }
          } else {
            providerStatuses[p.id] = { connected: true, state: 'error', error: msg }
          }
          console.error(`[folder-sync sw] ${p.id} sync error:`, e)
        }
      }
      if (Object.values(providerStatuses).every(s => s.state === 'synced')) await drainQueue(revisions)
      const states = Object.values(providerStatuses).map(s => s.state)
      const overall = states.includes('reconnect-required')
        ? 'reconnect-required'
        : states.every(s => s === 'synced')
          ? 'synced'
          : states.includes('error') ? 'error' : 'idle'
      await broadcast({ state: overall, lastSync: Date.now(), providers: providerStatuses, reason })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

// Every provider syncs every file against its *own* merge base, so a provider
// that was offline or stale cannot overwrite data another provider already
// delivered. The dirty queue only says "something changed"; it is cleared once
// every provider has synced.
async function syncOneProvider(provider) {
  const tok = await getTokens(provider.id)
  if (!tok) throw new Error('reconnect-required')

  for (const [name, codec] of Object.entries(RECORD_CODECS)) {
    // Record-level merge: deletions are carried as tombstones, so pushing
    // can never resurrect a row another device deleted.
    await reconcileRecord(provider, name, codec)
  }

  await syncProviderFiles(provider, {
    readLocal: readLocalRecord,
    replaceLocal,
    listLocal: listLocalNames,
    getMeta: key => idbGet(META_STORE, key),
    setMeta: (key, value) => idbSet(META_STORE, key, value),
    mergeFoodLog: (base, local, remote, name) =>
      mergeLogSnapshots(base, local, remote, name.startsWith('protein-') ? 'simple' : 'advanced'),
    skip: name => isSidecarPath(name) || !!RECORD_CODECS[name],
  })
}

async function drainQueue(revisions) {
  for (const [name, revision] of revisions) await dequeueIfUnchanged(name, revision)
}

// Record-level reconcile for one file, symmetric across push and pull: parses
// both sides into records, merges per-row with tombstones, writes the merged
// result + sidecar back to whichever side changed.
async function reconcileRecord(provider, name, codec) {
  const safe = async (fn) => { try { return await fn() } catch { return null } }
  return reconcileRecordsFile({
    path: name,
    codec,
    local: {
      readContent: p => readLocal(p),
      writeContent: (p, content) => writeLocal(p, content),
      readSidecar: p => readLocal(p),
      writeSidecar: (p, content) => writeLocal(p, content),
    },
    remote: {
      readContent: p => safe(() => provider.readRemote(provider, p)),
      writeContent: (p, content) => provider.writeRemote(provider, p, content),
      readSidecar: p => safe(() => provider.readRemote(provider, p)),
      writeSidecar: (p, content) => provider.writeRemote(provider, p, content),
    },
  })
}

// ---- local I/O from SW context ----
// The SW has no direct adapter reference. It uses a *shared protocol*:
//  - For browserStorage we can't access localStorage from a SW, so we proxy
//    through clients via postMessage. For now we restrict the SW to working
//    on shared IndexedDB-mirrored data: we keep a mirror of writes in the
//    'meta' store keyed by `local:<name>` so the SW can read latest content
//    even when no client is open. Writes from the engine update both.
//
// (When a future FSA adapter is involved, the engine can pass a sharable
// directory handle via postMessage — out of scope for v0.0.1.)
//
// To keep things simple and working today: engine mirrors every write to
// IndexedDB under store 'meta' key `local:<name>` and deletes mark it null.

async function readLocal(name) {
  const rec = await idbGet(META_STORE, `local:${name}`)
  if (!rec) return null
  return rec.deleted ? null : rec.content
}
async function readLocalRecord(name) {
  const rec = await idbGet(META_STORE, `local:${name}`)
  if (!rec) return null
  return { content: rec.deleted ? null : rec.content, mtime: rec.mtime || 0 }
}
async function listLocalNames() {
  const keys = await idbKeys(META_STORE)
  return keys.filter(k => typeof k === 'string' && k.startsWith('local:')).map(k => k.slice(6))
}
async function writeLocal(name, content) {
  await idbSet(META_STORE, `local:${name}`, { content, mtime: Date.now() })
  await notifyLocalChange(name)
}
// Replace local content only if it still equals `expected` (null = absent or
// deleted), atomically, so a concurrent UI write can never be clobbered.
async function replaceLocal(name, expected, content) {
  const wrote = await idbReplaceIf(
    META_STORE, `local:${name}`,
    rec => (rec && !rec.deleted ? rec.content : null) === expected,
    { content, mtime: Date.now() },
  )
  if (wrote) await notifyLocalChange(name)
  return wrote
}
async function notifyLocalChange(name) {
  // Notify clients so they can refresh their in-memory state / re-read via adapter.
  // Use `includeUncontrolled: true` because the SW's scope is narrow
  // (`/folder-sync/`) and the app page may not be controlled by this SW.
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
  for (const c of clients) c.postMessage({ type: 'remote-update', name })
}

async function broadcast(partial) {
  const bc = new BroadcastChannel(CHANNEL)
  bc.postMessage({ type: 'status', status: partial })
  bc.close()
}
