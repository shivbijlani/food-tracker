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
// Neither is a secret: both are public OAuth client ids for browser apps.
// OneDrive: pre-registered Azure app id (same one the project used before).
// Google: OAuth "Web application" client in the "MealJot" Google Cloud project
// (consent screen branded MealJot; JS origins https://mealjot.com and
// http://localhost:5173). VITE_GOOGLE_CLIENT_ID overrides it (e.g. forks).
// While empty, Google Drive stays hidden from the sync UI.
// Cloud project id: mealjot (owner shiv@bijlanis.com).
const MEALJOT_GOOGLE_CLIENT_ID = '879894537945-c75k9m67sijjge8bhtv89nv1nbvqomnj.apps.googleusercontent.com'
const ONEDRIVE_CLIENT_ID = import.meta.env?.VITE_ONEDRIVE_CLIENT_ID
  || '94f25f67-e08b-415e-b1aa-4159093d401d'
const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID || MEALJOT_GOOGLE_CLIENT_ID

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
    // Simple mode logs to protein-YYYY-MM.md, advanced to entries-YYYY-MM.md
    // (older simple data may live in entries files tagged `mode: simple`).
    // Newest month with data wins; ties go to protein files.
    const logFiles = files
      .map(n => n.match(/^(entries|protein)-(\d{4}-\d{2})\.md$/))
      .filter(Boolean)
      .sort((a, b) => b[2].localeCompare(a[2]) || (a[1] === 'protein' ? -1 : 1))

    for (const [name, kind] of logFiles.slice(0, 4)) {
      const text = await _engine.readFile(name)
      if (!text) continue
      const dataRows = text.split('\n').filter(l => l.startsWith('|') && !/^[|\s:-]+$/.test(l)).length - 1
      if (dataRows < 1) continue
      if (kind === 'protein') return 'simple'
      // Quick frontmatter peek — don't import full parser to avoid circular deps.
      const fm = text.match(/^---\s*\n([\s\S]*?)\n---/m)
      const modeMatch = fm && fm[1].match(/^mode:\s*(\S+)/m)
      return modeMatch && modeMatch[1] === 'simple' ? 'simple' : 'advanced'
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
