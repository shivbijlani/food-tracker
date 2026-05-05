/**
 * Migration helpers — copy all files from one provider to another.
 *
 * For OAuth-redirect targets (OneDrive/Google Drive), we stash the file
 * payload in sessionStorage before init() so we can finish writing on return.
 */
import { PROVIDERS, setProvider } from './storage.js'
import { LocalStorageProvider } from './localstorage-provider.js'
import { FSAProvider } from './fsa-provider.js'
import { OneDriveProvider } from './onedrive-provider.js'
import { GoogleDriveProvider } from './google-drive-provider.js'

const MIGRATION_KEY = 'pending-migration'

export function makeProvider(id, opts = {}) {
  switch (id) {
    case PROVIDERS.LOCAL_STORAGE: return new LocalStorageProvider()
    case PROVIDERS.FSA: return new FSAProvider()
    case PROVIDERS.ONEDRIVE: return new OneDriveProvider(opts.folderName || null)
    case PROVIDERS.GOOGLE_DRIVE: return new GoogleDriveProvider(opts.folderName || null)
    default: throw new Error(`Unknown provider: ${id}`)
  }
}

/** Read every file from a provider into {filename: content}. */
export async function snapshotFiles(provider) {
  const names = await provider.listFiles()
  const data = {}
  for (const name of names) {
    data[name] = await provider.readFile(name)
  }
  return data
}

/** Write every file from a payload to a provider. */
export async function restoreFiles(provider, payload) {
  for (const [name, content] of Object.entries(payload)) {
    await provider.writeFile(name, content)
  }
}

export function hasPendingMigration() {
  return !!sessionStorage.getItem(MIGRATION_KEY)
}

export function readPendingMigration() {
  const raw = sessionStorage.getItem(MIGRATION_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function clearPendingMigration() {
  sessionStorage.removeItem(MIGRATION_KEY)
}

/**
 * Migrate all data from currently active provider to a new target.
 *
 * @param {object} fromProvider — currently active provider instance
 * @param {string} toId — target provider id from PROVIDERS
 * @param {object} opts
 * @param {boolean} [opts.deleteSource=false] — wipe source after success (LocalStorage only)
 * @returns {Promise<{ok: boolean, redirected?: boolean, error?: string}>}
 */
export async function migrate(fromProvider, toId, opts = {}) {
  // Snapshot all current files
  const payload = await snapshotFiles(fromProvider)

  const target = makeProvider(toId)

  // For OAuth providers, stash payload before redirect
  if (toId === PROVIDERS.ONEDRIVE || toId === PROVIDERS.GOOGLE_DRIVE) {
    sessionStorage.setItem(MIGRATION_KEY, JSON.stringify({
      toId,
      payload,
      deleteSource: !!opts.deleteSource,
      fromId: opts.fromId || null,
      folderName: opts.folderName || null,
    }))
    // init() may redirect away — that's fine, we'll resume on return
    const ok = await target.init()
    if (ok && await target.isReady()) {
      // No redirect happened (already authed) — finish migration now
      await restoreFiles(target, payload)
      sessionStorage.removeItem(MIGRATION_KEY)
      setProvider(target)
      localStorage.setItem('storage-provider', toId)
      if (opts.deleteSource && fromProvider.clear) await fromProvider.clear()
      return { ok: true }
    }
    // Redirect was triggered (or auth failed and we'll retry on return)
    return { ok: false, redirected: true }
  }

  // Synchronous targets (LocalStorage, FSA)
  const ok = await target.init()
  if (!ok || !(await target.isReady())) {
    return { ok: false, error: 'Failed to initialize target storage' }
  }
  await restoreFiles(target, payload)
  setProvider(target)
  localStorage.setItem('storage-provider', toId)
  if (opts.deleteSource && fromProvider.clear) await fromProvider.clear()
  return { ok: true }
}

/**
 * Called at app startup. If we're returning from an OAuth redirect with a
 * pending migration, complete it. Returns the resulting provider id, or null
 * if no migration was pending.
 */
export async function resumePendingMigration() {
  const pending = readPendingMigration()
  if (!pending) return null

  const target = makeProvider(pending.toId, { folderName: pending.folderName || null })
  const ok = await target.init()
  if (!ok || !(await target.isReady())) {
    return null // OAuth might still be pending or failed
  }
  await restoreFiles(target, pending.payload)
  setProvider(target)
  localStorage.setItem('storage-provider', pending.toId)
  if (pending.deleteSource && pending.fromId === PROVIDERS.LOCAL_STORAGE) {
    const src = new LocalStorageProvider()
    await src.clear()
  }
  clearPendingMigration()
  return pending.toId
}
