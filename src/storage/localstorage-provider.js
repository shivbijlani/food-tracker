/**
 * Browser localStorage provider — default for all new visitors.
 * No setup needed, works on every browser/device, no internet required.
 * Limit: ~5 MB depending on browser.
 */
import { StorageProvider } from './storage.js'

const PREFIX = 'ft-file:'
const FOLDER_KEY = 'ft-folder-name'

const DAILY_LOG_HEADERS = '| Date | Meal | Food Description | Calories | Protein (g) | Fat (g) | Carbs (g) | Fiber (g) | Notes |'
const PROTEIN_LOG_HEADERS = '| Date | Meal | Protein (g) |'
const GOALS_HEADERS = '| Goal | Target | Notes |'
const RECIPES_HEADERS = '| Recipe | Servings | Calories | Protein (g) | Fat (g) | Carbs (g) | Fiber (g) | Notes |'

export class LocalStorageProvider extends StorageProvider {
  async init() { return true }
  async isReady() { return true }
  async getFolderName() {
    return localStorage.getItem(FOLDER_KEY) || 'Browser Storage'
  }

  async readFile(filename) {
    return localStorage.getItem(PREFIX + filename) ?? ''
  }

  async writeFile(filename, contents) {
    localStorage.setItem(PREFIX + filename, contents)
  }

  async deleteFile(filename) {
    localStorage.removeItem(PREFIX + filename)
  }

  async listFiles() {
    const files = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX)) files.push(key.slice(PREFIX.length))
    }
    return files
  }

  async scaffold(isSimpleMode = false) {
    const files = isSimpleMode
      ? [
          ['protein-log.md', `# Protein Log\n\n${PROTEIN_LOG_HEADERS}\n|---|---|---|\n`],
          ['goals.md', `# Goals\n\n${GOALS_HEADERS}\n|---|---|---|\n| Protein | 120g | Daily target |\n`],
          ['systems.md', `# Systems\n\nDaily protein tracking with success/failure framework.\n`],
        ]
      : [
          ['daily-log.md', `# Daily Log\n\n${DAILY_LOG_HEADERS}\n|---|---|---|---|---|---|---|---|---|\n`],
          ['goals.md', `# Goals\n\n${GOALS_HEADERS}\n|---|---|---|\n| Calories | 2000 | Daily target |\n| Protein | 120g | Daily target |\n| Fiber | 25g | Daily target |\n`],
          ['recipes.md', `# Recipes\n\n${RECIPES_HEADERS}\n|---|---|---|---|---|---|---|---|\n`],
        ]
    for (const [name, content] of files) {
      if (localStorage.getItem(PREFIX + name) === null) {
        await this.writeFile(name, content)
      }
    }
  }

  /** Wipe all files (used after migrating away). */
  async clear() {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    keys.forEach(k => localStorage.removeItem(k))
  }
}
