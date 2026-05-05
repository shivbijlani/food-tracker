/**
 * Storage abstraction layer supporting:
 * - FSA (File System Access API) for desktop Chrome/Edge
 * - OneDrive via Microsoft Graph API
 * - Google Drive via Drive API v3
 */

// Storage provider types
export const PROVIDERS = {
  LOCAL_STORAGE: 'local-storage',
  FSA: 'fsa',
  ONEDRIVE: 'onedrive',
  GOOGLE_DRIVE: 'google-drive'
}

// Detect available providers
export function getAvailableProviders() {
  const providers = [PROVIDERS.LOCAL_STORAGE]
  
  // FSA only available in secure contexts on Chromium browsers
  if (window.showDirectoryPicker && window.isSecureContext) {
    providers.push(PROVIDERS.FSA)
  }
  
  // Cloud providers always available (need internet)
  providers.push(PROVIDERS.ONEDRIVE, PROVIDERS.GOOGLE_DRIVE)
  
  return providers
}

// Get friendly names for providers
export function getProviderName(provider) {
  switch (provider) {
    case PROVIDERS.LOCAL_STORAGE: return 'Browser Storage'
    case PROVIDERS.FSA: return 'Local Folder'
    case PROVIDERS.ONEDRIVE: return 'OneDrive'
    case PROVIDERS.GOOGLE_DRIVE: return 'Google Drive'
    default: return provider
  }
}

// Storage interface that all providers must implement
class StorageProvider {
  /**
   * Initialize/authenticate the provider
   * @returns {Promise<boolean>} success
   */
  async init() { throw new Error('Not implemented') }
  
  /**
   * Check if provider is ready to use
   * @returns {Promise<boolean>}
   */
  async isReady() { throw new Error('Not implemented') }
  
  /**
   * Get folder display name for UI
   * @returns {Promise<string>}
   */
  async getFolderName() { throw new Error('Not implemented') }
  
  /**
   * Read file contents
   * @param {string} filename 
   * @returns {Promise<string>}
   */
  async readFile(filename) { throw new Error('Not implemented') }
  
  /**
   * Write file contents
   * @param {string} filename 
   * @param {string} contents 
   * @returns {Promise<void>}
   */
  async writeFile(filename, contents) { throw new Error('Not implemented') }
  
  /**
   * Delete file
   * @param {string} filename 
   * @returns {Promise<void>}
   */
  async deleteFile(filename) { throw new Error('Not implemented') }
  
  /**
   * List files in folder
   * @returns {Promise<string[]>} filenames
   */
  async listFiles() { throw new Error('Not implemented') }
  
  /**
   * Create initial scaffold files
   * @param {boolean} isSimpleMode 
   * @returns {Promise<void>}
   */
  async scaffold(isSimpleMode = false) { throw new Error('Not implemented') }
}

// Current provider singleton
let currentProvider = null

/**
 * Set the active storage provider
 * @param {StorageProvider} provider 
 */
export function setProvider(provider) {
  currentProvider = provider
}

/**
 * Get the current storage provider
 * @returns {StorageProvider}
 */
export function getProvider() {
  if (!currentProvider) {
    throw new Error('No storage provider configured')
  }
  return currentProvider
}

/**
 * Storage API that delegates to current provider
 */
export const storage = {
  async init() {
    return currentProvider?.init()
  },
  
  async isReady() {
    return currentProvider?.isReady() || false
  },
  
  async getFolderName() {
    return currentProvider?.getFolderName() || 'Unknown'
  },
  
  async readFile(filename) {
    return currentProvider?.readFile(filename)
  },
  
  async writeFile(filename, contents) {
    return currentProvider?.writeFile(filename, contents)
  },
  
  async deleteFile(filename) {
    return currentProvider?.deleteFile(filename)
  },
  
  async listFiles() {
    return currentProvider?.listFiles() || []
  },
  
  async scaffold(isSimpleMode = false) {
    return currentProvider?.scaffold(isSimpleMode)
  }
}

// Export the interface for provider implementations
export { StorageProvider }