/**
 * File System Access API provider for desktop browsers
 */
import { get, set } from 'idb-keyval'
import { StorageProvider } from './storage.js'

const DAILY_LOG_HEADERS = '| Date | Meal | Food Description | Calories | Protein (g) | Fat (g) | Carbs (g) | Fiber (g) | Notes |'
const PROTEIN_LOG_HEADERS = '| Date | Meal | Protein (g) |'
const GOALS_HEADERS = '| Goal | Target | Notes |'
const RECIPES_HEADERS = '| Recipe | Servings | Calories | Protein (g) | Fat (g) | Carbs (g) | Fiber (g) | Notes |'

export class FSAProvider extends StorageProvider {
  constructor() {
    super()
    this.dirHandle = null
  }

  /** Restore a previously-saved handle (no picker). Returns true only if permission already granted. */
  async init() {
    try {
      this.dirHandle = await get('fsa-directory')
      if (!this.dirHandle) return false
      const permission = await this.dirHandle.queryPermission({ mode: 'readwrite' })
      if (permission === 'granted') return true
      this.dirHandle = null
      return false
    } catch {
      this.dirHandle = null
      return false
    }
  }

  /** Show directory picker (requires user gesture). Returns the handle or null. */
  async pick() {
    try {
      this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
      await set('fsa-directory', this.dirHandle)
      return this.dirHandle
    } catch {
      return null
    }
  }
  
  async isReady() {
    if (!this.dirHandle) return false
    try {
      const permission = await this.dirHandle.queryPermission({ mode: 'readwrite' })
      return permission === 'granted'
    } catch (e) {
      return false
    }
  }
  
  async getFolderName() {
    return this.dirHandle?.name || 'Unknown Folder'
  }
  
  async readFile(filename) {
    if (!this.dirHandle) throw new Error('FSA not initialized')
    
    try {
      const fileHandle = await this.dirHandle.getFileHandle(filename)
      const file = await fileHandle.getFile()
      return await file.text()
    } catch (e) {
      if (e.name === 'NotFoundError') {
        return '' // File doesn't exist
      }
      throw e
    }
  }
  
  async writeFile(filename, contents) {
    if (!this.dirHandle) throw new Error('FSA not initialized')
    
    const fileHandle = await this.dirHandle.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(contents)
    await writable.close()
  }
  
  async deleteFile(filename) {
    if (!this.dirHandle) throw new Error('FSA not initialized')
    
    try {
      await this.dirHandle.removeEntry(filename)
    } catch (e) {
      if (e.name !== 'NotFoundError') throw e
    }
  }
  
  async listFiles() {
    if (!this.dirHandle) throw new Error('FSA not initialized')
    
    const files = []
    for await (const [name, handle] of this.dirHandle.entries()) {
      if (handle.kind === 'file') {
        files.push(name)
      }
    }
    return files
  }
  
  async scaffold(isSimpleMode = false) {
    if (!this.dirHandle) throw new Error('FSA not initialized')
    
    try {
      if (isSimpleMode) {
        await this.scaffoldSimpleMode()
      } else {
        await this.scaffoldAdvancedMode()
      }
    } catch (e) {
      console.error('Scaffold failed:', e)
      throw e
    }
  }
  
  async scaffoldSimpleMode() {
    const files = [
      ['protein-log.md', `# Protein Log\n\n${PROTEIN_LOG_HEADERS}\n|---|---|---|\n`],
      ['goals.md', `# Goals\n\n${GOALS_HEADERS}\n|---|---|---|\n| Protein | 120g | Daily target |\n`],
      ['systems.md', `# Systems\n\nDaily protein tracking system with visual progress.\n\n## Success/Failure Framework\n- Green: On track with daily goal\n- Yellow: Close to goal (within 80%)\n- Red: Below 80% of goal\n\n## Planning\n- Track what you plan vs what you eat\n- Visual progress bar shows progress throughout the day\n`]
    ]
    
    for (const [filename, content] of files) {
      const exists = await this.fileExists(filename)
      if (!exists) {
        await this.writeFile(filename, content)
      }
    }
  }
  
  async scaffoldAdvancedMode() {
    const files = [
      ['daily-log.md', `# Daily Log\n\n${DAILY_LOG_HEADERS}\n|---|---|---|---|---|---|---|---|---|\n`],
      ['goals.md', `# Goals\n\n${GOALS_HEADERS}\n|---|---|---|\n| Calories | 2000 | Daily target |\n| Protein | 120g | Daily target |\n| Fiber | 25g | Daily target |\n`],
      ['recipes.md', `# Recipes\n\n${RECIPES_HEADERS}\n|---|---|---|---|---|---|---|---|\n`]
    ]
    
    for (const [filename, content] of files) {
      const exists = await this.fileExists(filename)
      if (!exists) {
        await this.writeFile(filename, content)
      }
    }
  }
  
  async fileExists(filename) {
    try {
      await this.dirHandle.getFileHandle(filename)
      return true
    } catch (e) {
      return false
    }
  }
}