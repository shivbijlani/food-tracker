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
import { scaffoldFile } from './mdyaml.js'

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

  /**
   * Create initial scaffold files if they don't exist. Mode-aware.
   * Lives here (not in adapters) because scaffold content is app-specific.
   *
   * Sync-aware: if a cloud provider is connected and we're online, wait for
   * the first sync cycle to complete before checking whether each scaffold
   * file exists. Without this, a fresh page load would write stub files
   * locally and enqueue them for upload *before* the SW had a chance to
   * pull the user's real files down from the cloud — clobbering them.
   */
  async scaffold(isSimpleMode = false) {
    const safe = await waitForFirstSync()
    // If we timed out waiting for the first sync, do NOT scaffold. Writing
    // stub files now would race the eventual pull and could overwrite the
    // user's real cloud copies. They can reload to retry; meanwhile the
    // app still works against whatever the local mirror contains.
    if (!safe) return
    const files = isSimpleMode ? scaffoldSimple() : scaffoldAdvanced()
    for (const [name, content] of files) {
      const existing = await _engine.readFile(name)
      if (!existing) await _engine.writeFile(name, content)
    }
  },
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__storage = storage
  window.__getEngine = getEngine
}

/**
 * Resolve `true` once it's safe to scaffold default files without risk of
 * overwriting remote content. Resolves `false` if we hit the hard timeout
 * — caller should skip scaffolding in that case.
 *
 * Safe when:
 *   - no providers are configured (purely local app), OR
 *   - no providers are connected (user hasn't enabled cloud sync), OR
 *   - the user is offline (no remote to clobber — sync queue will reconcile
 *     when they come back online), OR
 *   - the connected provider has completed at least one sync cycle this
 *     session (overall state transitions to 'synced', 'idle', 'error', or
 *     'reconnect-required' after the initial 'syncing' phase).
 */
const FIRST_SYNC_TIMEOUT_MS = 15_000
let _firstSyncPromise = null
function waitForFirstSync() {
  if (_firstSyncPromise) return _firstSyncPromise
  _firstSyncPromise = new Promise((resolve) => {
    if (!_engine) return resolve(true)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return resolve(true)

    if (typeof _engine.listProviders === 'function' && _engine.listProviders().length === 0) {
      return resolve(true)
    }

    let done = false
    let sawConnectedProvider = false
    const finish = (safe) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { unsub() } catch { /* ignore */ }
      resolve(safe)
    }

    const FATAL = new Set(['error', 'reconnect-required', 'offline'])

    const check = (s) => {
      const provs = s?.providers || {}
      const connected = Object.values(provs).some(p => p?.connected)
      if (connected) sawConnectedProvider = true

      // Resolve early if we previously saw a connected provider and now
      // none are connected — means the user explicitly disconnected mid-
      // session. We deliberately do NOT exit on the first emission with no
      // connected flag: token-restore runs async, so the initial status
      // often shows providers without connected:true for a brief moment.
      // Exiting there would race the SW's first pull and let scaffold
      // clobber the user's real cloud files.
      if (!connected && Object.keys(provs).length > 0 && sawConnectedProvider) return finish(true)

      if (s?.lastSync) return finish(true)
      if (s?.state && FATAL.has(s.state)) return finish(true)
      if (Object.values(provs).some(p => p?.state && FATAL.has(p.state))) return finish(true)
    }

    const unsub = _engine.subscribe(check)
    const timer = setTimeout(() => finish(false), FIRST_SYNC_TIMEOUT_MS)
  })
  return _firstSyncPromise
}

const GOALS_COLS = ['Nutrient','Target','Notes']
const RECIPE_COLS = ['Recipe','Servings','Calories','Protein (g)','Calcium (mg)','Notes']
const SUGGESTIONS_COLS = ['name', 'calories', 'protein', 'calcium', 'veg', 'omega3']

function scaffoldAdvanced() {
  const goalsContent = scaffoldFile({ kind: 'goals', headers: GOALS_COLS, title: 'Goals' })
    .replace(/\| Nutrient \| Target \| Notes \|\n\|[^\n]+\|\n/, m => m + '| Calories | 2000 | Daily target |\n| Protein | 120g | Daily target |\n')
  return [
    ['goals.md', goalsContent],
    ['recipes.md', scaffoldFile({ kind: 'recipes', headers: RECIPE_COLS, title: 'Recipes' })],
    ['suggestions.csv', SUGGESTIONS_COLS.join(',') + '\n'],
  ]
}

function scaffoldSimple() {
  const goalsContent = scaffoldFile({ kind: 'goals', headers: GOALS_COLS, title: 'Goals' })
    .replace(/\| Nutrient \| Target \| Notes \|\n\|[^\n]+\|\n/, m => m + '| Protein | 120g | Daily target |\n')
  return [
    ['goals.md', goalsContent],
    ['systems.md', `---\nschemaVersion: 1\nkind: notes\n---\n\n# Systems\n\nDaily protein tracking with success/failure framework.\n`],
    ['suggestions.csv', SUGGESTIONS_COLS.join(',') + '\n'],
  ]
}
