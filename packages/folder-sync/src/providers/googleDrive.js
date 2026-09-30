// Google Drive provider — Drive API v3 + browser-safe OAuth token flow.
// Mirror of oneDrive.js. Uses appDataFolder so files are sandboxed to the app.
//
// Why not auth-code + PKCE like OneDrive: Google's token endpoint requires a
// client_secret for "Web application" OAuth clients even when PKCE is used,
// and a secret can't be shipped in a static browser app. So we use the OAuth
// 2.0 token model (response_type=token): Google redirects back with a
// short-lived (~1h) access token in the URL fragment, with no token-endpoint
// call. There is no refresh token; when the token expires the engine signals
// `reconnect-required` and re-runs startAuth, which Google completes without
// a consent screen once the user has granted access (account chooser only if
// several Google accounts are signed in).

import { generateState } from '../auth/pkce.js'
import { getTokens, setTokens, clearTokens, isExpired } from '../auth/tokenStore.js'

const PROVIDER_ID = 'google-drive'
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata'
const SPACES = 'appDataFolder'
const STATE_KEY = `${PROVIDER_ID}_state`

export function googleDriveProvider({ clientId }) {
  return {
    id: PROVIDER_ID,
    displayName: 'Google Drive',
    clientId,
    scopes: SCOPES,
    authEndpoint: AUTH_ENDPOINT,
    startAuth: (redirectUri) => startAuth(clientId, redirectUri),
    completeAuth: (params, redirectUri) => completeAuth(clientId, params, redirectUri),
    listRemote,
    readRemote,
    writeRemote,
    deleteRemote,
    refresh: () => refresh(),
  }
}

export function buildAuthUrl(clientId, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    include_granted_scopes: 'true',
  })
  return `${AUTH_ENDPOINT}?${params}`
}

async function startAuth(clientId, redirectUri) {
  const state = generateState()
  sessionStorage.setItem(STATE_KEY, state)
  window.location.href = buildAuthUrl(clientId, redirectUri, state)
}

// `params` holds the redirect's query + fragment parameters (see engine).
async function completeAuth(_clientId, params) {
  const state = params.get('state')
  const storedState = sessionStorage.getItem(STATE_KEY)
  if (!state || !storedState || storedState !== state) return false
  sessionStorage.removeItem(STATE_KEY)

  const error = params.get('error')
  if (error) throw new Error(`Google sign-in failed: ${error}`)
  const accessToken = params.get('access_token')
  if (!accessToken) throw new Error('Google: missing access token')
  const granted = (params.get('scope') || '').split(/\s+/)
  if (!granted.includes(SCOPES)) {
    throw new Error('Google: Drive access was not granted — tick the Drive checkbox on the consent screen')
  }
  const expiresIn = Number(params.get('expires_in')) || 3600
  await setTokens(PROVIDER_ID, {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  })
  return true
}

async function refresh() {
  await clearTokens(PROVIDER_ID)
  throw new Error('reconnect-required')
}

async function ensureToken() {
  const rec = await getTokens(PROVIDER_ID)
  if (!rec || isExpired(rec)) throw new Error('reconnect-required')
  return rec.accessToken
}

// Drive returns 401 once a token is revoked or expires early.
async function driveFetch(url, init = {}) {
  const token = await ensureToken()
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    await clearTokens(PROVIDER_ID)
    throw new Error('reconnect-required')
  }
  return res
}

async function listRemote() {
  const url = new URL(`${DRIVE_BASE}/files`)
  url.searchParams.set('spaces', SPACES)
  url.searchParams.set('q', 'trashed=false')
  url.searchParams.set('fields', 'nextPageToken,files(id,name,modifiedTime)')
  url.searchParams.set('pageSize', '1000')
  const files = []
  let pageToken = null
  do {
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await driveFetch(url)
    if (!res.ok) throw new Error(`Google list failed: ${res.status}`)
    const data = await res.json()
    files.push(...(data.files || []))
    pageToken = data.nextPageToken || null
  } while (pageToken)
  return files.map(f => ({
    name: f.name,
    mtime: new Date(f.modifiedTime).getTime(),
    _id: f.id,
  }))
}

export function nameQuery(filename) {
  const escaped = filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `name='${escaped}' and trashed=false`
}

async function findFileId(filename) {
  const url = new URL(`${DRIVE_BASE}/files`)
  url.searchParams.set('spaces', SPACES)
  url.searchParams.set('q', nameQuery(filename))
  url.searchParams.set('fields', 'files(id)')
  const res = await driveFetch(url)
  if (!res.ok) throw new Error(`Google query failed: ${res.status}`)
  const data = await res.json()
  return data.files?.[0]?.id || null
}

async function readRemote(_providerConfig, filename) {
  const id = await findFileId(filename)
  if (!id) return null
  const res = await driveFetch(`${DRIVE_BASE}/files/${id}?alt=media`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Google read failed: ${res.status}`)
  return await res.text()
}

async function writeRemote(_providerConfig, filename, contents) {
  const existingId = await findFileId(filename)
  const boundary = 'fs-' + Math.random().toString(36).slice(2)
  const metadata = existingId
    ? { name: filename }
    : { name: filename, parents: [SPACES] }
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
    contents +
    `\r\n--${boundary}--`

  const url = existingId
    ? `${UPLOAD_BASE}/files/${existingId}?uploadType=multipart&fields=id,modifiedTime`
    : `${UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime`
  const res = await driveFetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) throw new Error(`Google write failed: ${res.status}`)
  const data = await res.json()
  return { mtime: new Date(data.modifiedTime).getTime() }
}

async function deleteRemote(_providerConfig, filename) {
  const id = await findFileId(filename)
  if (!id) return
  const res = await driveFetch(`${DRIVE_BASE}/files/${id}`, { method: 'DELETE' })
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`Google delete failed: ${res.status}`)
  }
}