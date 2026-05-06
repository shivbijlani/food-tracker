/**
 * OneDrive provider using Microsoft Graph API with PKCE OAuth2.
 * Uses the special App Folder (Files.ReadWrite.AppFolder scope) —
 * sandboxed to /Apps/Food Tracker/ with no broad file access needed.
 */
import { StorageProvider } from './storage.js'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

// Azure app registration (registered 2026-05-05)
const CLIENT_ID = '94f25f67-e08b-415e-b1aa-4159093d401d'
const SCOPES = 'Files.ReadWrite.AppFolder offline_access'

// All files live directly under the app folder root
const APPROOT = `${GRAPH_BASE}/me/drive/special/approot`

export class OneDriveProvider extends StorageProvider {
  constructor() {
    super()
    this.accessToken = null
    this.refreshToken = null
    this.expiresAt = null
  }

  async init() {
    this.loadTokens()
    if (this.isTokenValid()) return true

    if (this.refreshToken) {
      try {
        await this.refreshAccessToken()
        if (this.isTokenValid()) return true
      } catch { /* fall through */ }
    }

    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')
    const error = urlParams.get('error')

    if (error) throw new Error(`OAuth2 error: ${error}`)

    if (code && state) {
      const success = await this.exchangeCodeForTokens(code, state)
      if (success) {
        window.history.replaceState({}, document.title, window.location.pathname)
        return true
      }
    }

    await this.authenticate()
    return false
  }

  async isReady() {
    await this.ensureValidToken()
    return !!this.accessToken
  }

  async getFolderName() {
    return 'OneDrive (App Folder)'
  }

  async readFile(filename) {
    await this.ensureValidToken()
    const url = `${APPROOT}:/${filename}:/content`
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } })
      if (res.status === 404) return ''
      if (!res.ok) throw new Error(`Failed to read file: ${res.status}`)
      return await res.text()
    } catch (e) {
      if (e.message.includes('404')) return ''
      throw e
    }
  }

  async writeFile(filename, contents) {
    await this.ensureValidToken()
    const url = `${APPROOT}:/${filename}:/content`
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'text/plain' },
      body: contents
    })
    if (!res.ok) throw new Error(`Failed to write file: ${res.status}`)
  }

  async deleteFile(filename) {
    await this.ensureValidToken()
    const url = `${APPROOT}:/${filename}`
    try {
      const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${this.accessToken}` } })
      if (res.status !== 204 && res.status !== 404) throw new Error(`Failed to delete file: ${res.status}`)
    } catch (e) {
      if (!e.message.includes('404')) throw e
    }
  }

  async listFiles() {
    await this.ensureValidToken()
    const url = `${APPROOT}/children`
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } })
      if (res.status === 404) return []
      if (!res.ok) throw new Error(`Failed to list files: ${res.status}`)
      const data = await res.json()
      return data.value.filter(item => item.file).map(item => item.name)
    } catch (e) {
      if (e.message.includes('404')) return []
      throw e
    }
  }

  async scaffold(isSimpleMode = false) {
    const files = isSimpleMode ? this.getSimpleModeFiles() : this.getAdvancedModeFiles()
    for (const [filename, content] of files) {
      const existing = await this.readFile(filename)
      if (!existing) await this.writeFile(filename, content)
    }
  }

  async authenticate() {
    const codeVerifier = this.generateCodeVerifier()
    const codeChallenge = await this.generateCodeChallenge(codeVerifier)
    const state = this.generateState()

    localStorage.setItem('onedrive_code_verifier', codeVerifier)
    localStorage.setItem('onedrive_state', state)

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: window.location.origin + window.location.pathname,
      scope: SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    })
    window.location.href = `${AUTH_ENDPOINT}?${params}`
  }

  async exchangeCodeForTokens(code, state) {
    const storedState = localStorage.getItem('onedrive_state')
    const codeVerifier = localStorage.getItem('onedrive_code_verifier')
    if (!storedState || storedState !== state) throw new Error('Invalid state parameter')
    if (!codeVerifier) throw new Error('Missing code verifier')

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: window.location.origin + window.location.pathname,
      code_verifier: codeVerifier
    })
    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
      const data = await res.json()
      this.accessToken = data.access_token
      this.refreshToken = data.refresh_token
      this.expiresAt = Date.now() + data.expires_in * 1000 - 60000
      this.saveTokens()
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
    if (this.refreshToken) await this.refreshAccessToken()
    else await this.authenticate()
  }

  async refreshAccessToken() {
    if (!this.refreshToken) throw new Error('No refresh token')
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      scope: SCOPES
    })
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!res.ok) {
      this.clearTokens()
      await this.authenticate()
      return
    }
    const data = await res.json()
    this.accessToken = data.access_token
    if (data.refresh_token) this.refreshToken = data.refresh_token
    this.expiresAt = Date.now() + data.expires_in * 1000 - 60000
    this.saveTokens()
  }

  isTokenValid() {
    return !!(this.accessToken && this.expiresAt && Date.now() < this.expiresAt)
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
    return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

  async generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
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
      ['systems.md', '# Systems\n\nDaily protein tracking system.\n']
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
