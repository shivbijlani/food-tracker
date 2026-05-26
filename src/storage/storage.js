/**
 * Storage facade — backed by @shivbijlani/folder-sync.
 *
 * Exposes the same `storage` shape the app has always used (readFile / writeFile /
 * listFiles / scaffold / getFolderName), so consumers don't need to think about
 * the underlying sync engine.
 *
 * Cloud (OneDrive / Google Drive) is no longer a *primary* storage choice — it's
 * a sync target. The primary is always local (Browser Storage or Local Folder).
 *
 * Use `engine` directly for: subscribe(), connect(), disconnect(), syncNow(),
 * listProviders().
 */

import {
  createSyncEngine,
  registerServiceWorker,
  browserStorageAdapter,
  fsaAdapter,
  oneDriveProvider,
  googleDriveProvider,
  mockProvider,
} from '@shivbijlani/folder-sync'

// ---- Public provider IDs (now: only local primary) ----
export const PROVIDERS = Object.freeze({
  LOCAL_STORAGE: 'browser-storage',
  FSA: 'fsa',
})

export function getAvailableProviders() {
  const out = [PROVIDERS.LOCAL_STORAGE]
  if (typeof window !== 'undefined' && window.showDirectoryPicker && window.isSecureContext) {
    out.push(PROVIDERS.FSA)
  }
  return out
}

export function getProviderName(id) {
  switch (id) {
    case PROVIDERS.LOCAL_STORAGE: return 'Browser Storage'
    case PROVIDERS.FSA: return 'Local Folder'
    case 'onedrive': return 'OneDrive'
    case 'google-drive': return 'Google Drive'
    case 'mock': return 'Mock (dev)'
    default: return id
  }
}

// ---- Cloud provider client IDs ----
// OneDrive: pre-registered Azure app id (same one the project used before).
// Google: requires a client id; expose via Vite env, fall back to disabled if absent.
const ONEDRIVE_CLIENT_ID = import.meta.env?.VITE_ONEDRIVE_CLIENT_ID
  || '94f25f67-e08b-415e-b1aa-4159093d401d'
const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID || ''

const PRIMARY_KEY = 'storage-primary'

function makeAdapter(id) {
  if (id === PROVIDERS.FSA) return fsaAdapter()
  return browserStorageAdapter({ prefix: 'ft-file:' })
}

function makeProviders() {
  const providers = [oneDriveProvider({ clientId: ONEDRIVE_CLIENT_ID })]
  if (GOOGLE_CLIENT_ID) {
    providers.push(googleDriveProvider({ clientId: GOOGLE_CLIENT_ID }))
  }
  // DEV-only mock provider for end-to-end sync testing without OAuth.
  // Toggle by setting `localStorage.setItem('folder-sync-mock', '1')` then reloading.
  if (import.meta.env?.DEV && typeof window !== 'undefined' && window.localStorage?.getItem('folder-sync-mock') === '1') {
    providers.push(mockProvider())
  }
  return providers
}

// ---- Engine singleton ----
let _engine = null
let _primaryId = null

export function getPrimaryId() {
  return _primaryId
}

export async function setPrimary(id) {
  if (!getAvailableProviders().includes(id)) {
    throw new Error(`Primary storage not available: ${id}`)
  }
  localStorage.setItem(PRIMARY_KEY, id)
  _primaryId = id
  _engine = createSyncEngine({
    localAdapter: makeAdapter(id),
    providers: makeProviders(),
  })
  await _engine.initLocal()
}

export async function initStorage() {
  const savedId = localStorage.getItem(PRIMARY_KEY) || PROVIDERS.LOCAL_STORAGE
  const wanted = getAvailableProviders().includes(savedId) ? savedId : PROVIDERS.LOCAL_STORAGE
  await setPrimary(wanted)
  // For FSA, the adapter may need a folder pick before it's truly ready.
  return _engine
}

/**
 * Inspect the most recent entry files to determine which mode (simple/advanced)
 * has data. Returns 'simple', 'advanced', or null (no data either way).
 * Only reads the frontmatter of up to 2 files, so it's fast.
 */
export async function detectModeFromData() {
  try {
    const files = await _engine.listFiles()
    const entryFiles = files
      .filter(n => /^entries-\d{4}-\d{2}\.md$/.test(n))
      .sort()
      .reverse() // newest first

    if (!entryFiles.length) return null

    // Read up to the 2 most recent files to find a mode hint.
    for (const name of entryFiles.slice(0, 2)) {
      const text = await _engine.readFile(name)
      if (!text) continue
      // Quick frontmatter peek — don't import full parser to avoid circular deps.
      const m = text.match(/^---\s*\n([\s\S]*?)\n---/m)
      if (!m) continue
      const modeMatch = m[1].match(/^mode:\s*(\S+)/m)
      const rowMatch = text.match(/^\|[^|]+\|/m) // any data rows?
      const hasData = rowMatch && text.split('\n').filter(l => l.startsWith('|') && !l.match(/^[| -]+$/)).length > 2
      if (modeMatch && hasData) return modeMatch[1] === 'simple' ? 'simple' : 'advanced'
    }

    // Fallback: presence of systems.md → simple mode had data
    if (files.includes('systems.md')) {
      const sysText = await _engine.readFile('systems.md')
      if (sysText && sysText.trim().length > 50) return 'simple'
    }

    return null
  } catch {
    return null
  }
}

export function getEngine() {
  if (!_engine) throw new Error('Storage not initialised — call initStorage() first.')
  return _engine
}

/**
 * Register the folder-sync service worker. Call once on app start.
 */
export async function registerSyncWorker() {
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
  return registerServiceWorker(`${base}/folder-sync/sw.js`, { type: 'module', scope: `${base}/folder-sync/` })
}

// ---- Backward-compatible thin facade ----
export const storage = {
  async init() { /* no-op — initStorage() is the new entry point */ return true },
  async isReady() { return _engine != null },
  async getFolderName() { return _engine ? _engine.getFolderName() : 'Browser Storage' },
  async readFile(name) { return _engine.readFile(name) },
  async writeFile(name, contents) { return _engine.writeFile(name, contents) },
  async deleteFile(name) { return _engine.deleteFile(name) },
  async listFiles() { return _engine.listFiles() },
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__storage = storage
  window.__getEngine = getEngine
}
