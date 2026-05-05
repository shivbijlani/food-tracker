/**
 * OneDrive provider using Microsoft Graph API with PKCE OAuth2
 */
import { StorageProvider } from './storage.js'

// Microsoft Graph API endpoints
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

// Azure app registration (registered 2026-05-05)
// App: Food Tracker | Tenant: All Microsoft accounts (personal + org)
const CLIENT_ID = '94f25f67-e08b-415e-b1aa-4159093d401d'
const SCOPES = 'Files.ReadWrite offline_access'
const FOLDER_PATH = '/food-tracker'

export class OneDriveProvider extends StorageProvider {
  constructor() {
    super()
    this.accessToken = null
    this.refreshToken = null
    this.expiresAt = null
  }
  
  async init() {
    // Check if we have valid tokens
    this.loadTokens()
    
    if (this.isTokenValid()) {
      return true
    }
    
    // Check for OAuth2 callback
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')
    const error = urlParams.get('error')
    
    if (error) {
      throw new Error(`OAuth2 error: ${error}`)
    }
    
    if (code && state) {
      // Complete OAuth2 flow
      const success = await this.exchangeCodeForTokens(code, state)
      if (success) {
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname)
        return true
      }
    }
    
    // Need to authenticate
    await this.authenticate()
    return false // Will redirect, so return false
  }
  
  async isReady() {
    await this.ensureValidToken()
    return !!this.accessToken
  }
  
  async getFolderName() {
    return 'OneDrive/food-tracker'
  }
  
  async readFile(filename) {
    await this.ensureValidToken()
    
    const path = `${FOLDER_PATH}/${filename}`
    const url = `${GRAPH_BASE}/me/drive/root:${path}:/content`
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      })
      
      if (response.status === 404) {
        return '' // File doesn't exist
      }
      
      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.status}`)
      }
      
      return await response.text()
    } catch (e) {
      if (e.message.includes('404')) {
        return ''
      }
      throw e
    }
  }
  
  async writeFile(filename, contents) {
    await this.ensureValidToken()
    await this.ensureFolderExists()
    
    const path = `${FOLDER_PATH}/${filename}`
    const url = `${GRAPH_BASE}/me/drive/root:${path}:/content`
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'text/plain'
      },
      body: contents
    })
    
    if (!response.ok) {
      throw new Error(`Failed to write file: ${response.status}`)
    }
  }
  
  async deleteFile(filename) {
    await this.ensureValidToken()
    
    const path = `${FOLDER_PATH}/${filename}`
    const url = `${GRAPH_BASE}/me/drive/root:${path}`
    
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      })
      
      if (response.status !== 204 && response.status !== 404) {
        throw new Error(`Failed to delete file: ${response.status}`)
      }
    } catch (e) {
      if (!e.message.includes('404')) throw e
    }
  }
  
  async listFiles() {
    await this.ensureValidToken()
    
    const path = FOLDER_PATH
    const url = `${GRAPH_BASE}/me/drive/root:${path}:/children`
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      })
      
      if (response.status === 404) {
        return [] // Folder doesn't exist yet
      }
      
      if (!response.ok) {
        throw new Error(`Failed to list files: ${response.status}`)
      }
      
      const data = await response.json()
      return data.value.filter(item => item.file).map(item => item.name)
    } catch (e) {
      if (e.message.includes('404')) {
        return []
      }
      throw e
    }
  }
  
  async scaffold(isSimpleMode = false) {
    const files = isSimpleMode ? this.getSimpleModeFiles() : this.getAdvancedModeFiles()
    
    for (const [filename, content] of files) {
      const existing = await this.readFile(filename)
      if (!existing) {
        await this.writeFile(filename, content)
      }
    }
  }
  
  // Private methods
  
  async authenticate() {
    const codeVerifier = this.generateCodeVerifier()
    const codeChallenge = await this.generateCodeChallenge(codeVerifier)
    const state = this.generateState()
    
    // Store for later
    localStorage.setItem('onedrive_code_verifier', codeVerifier)
    localStorage.setItem('onedrive_state', state)
    
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: window.location.origin + window.location.pathname,
      scope: SCOPES,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    })
    
    window.location.href = `${AUTH_ENDPOINT}?${params}`
  }
  
  async exchangeCodeForTokens(code, state) {
    const storedState = localStorage.getItem('onedrive_state')
    const codeVerifier = localStorage.getItem('onedrive_code_verifier')
    
    if (!storedState || storedState !== state) {
      throw new Error('Invalid state parameter')
    }
    
    if (!codeVerifier) {
      throw new Error('Missing code verifier')
    }
    
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: window.location.origin + window.location.pathname,
      code_verifier: codeVerifier
    })
    
    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body
      })
      
      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status}`)
      }
      
      const data = await response.json()
      
      this.accessToken = data.access_token
      this.refreshToken = data.refresh_token
      this.expiresAt = Date.now() + (data.expires_in * 1000) - 60000 // 1 min buffer
      
      this.saveTokens()
      
      // Cleanup
      localStorage.removeItem('onedrive_state')
      localStorage.removeItem('onedrive_code_verifier')
      
      return true
    } catch (e) {
      console.error('Token exchange error:', e)
      return false
    }
  }
  
  async ensureValidToken() {
    if (this.isTokenValid()) return
    
    if (this.refreshToken) {
      await this.refreshAccessToken()
    } else {
      await this.authenticate()
    }
  }
  
  async refreshAccessToken() {
    if (!this.refreshToken) throw new Error('No refresh token')
    
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      scope: SCOPES
    })
    
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body
    })
    
    if (!response.ok) {
      // Refresh failed, need to re-authenticate
      this.clearTokens()
      await this.authenticate()
      return
    }
    
    const data = await response.json()
    
    this.accessToken = data.access_token
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token
    }
    this.expiresAt = Date.now() + (data.expires_in * 1000) - 60000
    
    this.saveTokens()
  }
  
  async ensureFolderExists() {
    const url = `${GRAPH_BASE}/me/drive/root:${FOLDER_PATH}`
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      })
      
      if (response.status === 404) {
        // Create folder
        await this.createFolder()
      }
    } catch (e) {
      // Folder might not exist, try to create it
      await this.createFolder()
    }
  }
  
  async createFolder() {
    const url = `${GRAPH_BASE}/me/drive/root/children`
    
    const body = JSON.stringify({
      name: 'food-tracker',
      folder: {},
      '@microsoft.graph.conflictBehavior': 'rename'
    })
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: body
    })
    
    if (!response.ok && response.status !== 409) { // 409 = already exists
      throw new Error(`Failed to create folder: ${response.status}`)
    }
  }
  
  isTokenValid() {
    return this.accessToken && this.expiresAt && Date.now() < this.expiresAt
  }
  
  loadTokens() {
    this.accessToken = localStorage.getItem('onedrive_access_token')
    this.refreshToken = localStorage.getItem('onedrive_refresh_token')
    const expires = localStorage.getItem('onedrive_expires_at')
    this.expiresAt = expires ? parseInt(expires) : null
  }
  
  saveTokens() {
    localStorage.setItem('onedrive_access_token', this.accessToken)
    localStorage.setItem('onedrive_refresh_token', this.refreshToken)
    localStorage.setItem('onedrive_expires_at', this.expiresAt.toString())
  }
  
  clearTokens() {
    localStorage.removeItem('onedrive_access_token')
    localStorage.removeItem('onedrive_refresh_token')
    localStorage.removeItem('onedrive_expires_at')
    this.accessToken = null
    this.refreshToken = null
    this.expiresAt = null
  }
  
  generateCodeVerifier() {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }
  
  async generateCodeChallenge(verifier) {
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }
  
  generateState() {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    return btoa(String.fromCharCode(...array)).replace(/[^a-zA-Z0-9]/g, '')
  }
  
  getSimpleModeFiles() {
    return [
      ['protein-log.md', '# Protein Log\n\n| Date | Meal | Protein (g) |\n|---|---|---|\n'],
      ['goals.md', '# Goals\n\n| Goal | Target | Notes |\n|---|---|---|\n| Protein | 120g | Daily target |\n'],
      ['systems.md', '# Systems\n\nDaily protein tracking system with visual progress.\n\n## Success/Failure Framework\n- Green: On track with daily goal\n- Yellow: Close to goal (within 80%)\n- Red: Below 80% of goal\n\n## Planning\n- Track what you plan vs what you eat\n- Visual progress bar shows progress throughout the day\n']
    ]
  }
  
  getAdvancedModeFiles() {
    return [
      ['daily-log.md', '# Daily Log\n\n| Date | Meal | Food Description | Calories | Protein (g) | Fat (g) | Carbs (g) | Fiber (g) | Notes |\n|---|---|---|---|---|---|---|---|---|\n'],
      ['goals.md', '# Goals\n\n| Goal | Target | Notes |\n|---|---|---|\n| Calories | 2000 | Daily target |\n| Protein | 120g | Daily target |\n| Fiber | 25g | Daily target |\n'],
      ['recipes.md', '# Recipes\n\n| Recipe | Servings | Calories | Protein (g) | Fat (g) | Carbs (g) | Fiber (g) | Notes |\n|---|---|---|---|---|---|---|---|\n']
    ]
  }
}