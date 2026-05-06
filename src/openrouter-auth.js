// OpenRouter PKCE OAuth — user signs in to their OpenRouter account to get a personal API key.
// No app registration required. The key is user-controlled and stored in localStorage.
// Docs: https://openrouter.ai/docs/use-cases/oauth-pkce

const KEY_STORAGE = 'food-tracker-openrouter-key'
const VERIFIER_STORAGE = 'food-tracker-openrouter-verifier'
const OR_STATE = 'openrouter' // used as the OAuth state param to detect our callbacks

function generateVerifier() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function sha256Base64url(str) {
  const data = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', data)
  let binary = ''
  for (const b of new Uint8Array(hash)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** Redirect the user to OpenRouter to authorize. Stores the code_verifier for later. */
export async function startAuth() {
  const verifier = generateVerifier()
  const challenge = await sha256Base64url(verifier)
  localStorage.setItem(VERIFIER_STORAGE, verifier)

  const callbackUrl = `${window.location.origin}${window.location.pathname}`
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: OR_STATE,
  })
  window.location.href = `https://openrouter.ai/auth?${params}`
}

/**
 * Call on every page load. Returns true if we handled a pending OpenRouter callback.
 * Stores the resulting API key and cleans up the URL.
 */
export async function handleCallback() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('state') !== OR_STATE || !params.get('code')) return false

  const code = params.get('code')
  const verifier = localStorage.getItem(VERIFIER_STORAGE)
  if (!verifier) return false

  localStorage.removeItem(VERIFIER_STORAGE)

  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter auth failed (${res.status}): ${err}`)
  }

  const { key } = await res.json()
  if (!key) throw new Error('OpenRouter did not return a key')

  localStorage.setItem(KEY_STORAGE, key)

  // Remove OAuth params from URL without reloading
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  window.history.replaceState({}, '', url.toString())

  return true
}

export function getKey() {
  return localStorage.getItem(KEY_STORAGE) || null
}

export function clearKey() {
  localStorage.removeItem(KEY_STORAGE)
}

export function isConnected() {
  return !!getKey()
}
