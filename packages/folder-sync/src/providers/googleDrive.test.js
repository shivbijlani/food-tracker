import { describe, it, expect, beforeEach, vi } from 'vitest'

const tokens = new Map()
vi.mock('../auth/tokenStore.js', () => ({
  getTokens: async (id) => tokens.get(id) || null,
  setTokens: async (id, rec) => { tokens.set(id, { ...rec, providerId: id }) },
  clearTokens: async (id) => { tokens.delete(id) },
  isExpired: (rec, skew = 60_000) => !rec?.expiresAt || Date.now() >= rec.expiresAt - skew,
}))

const { googleDriveProvider, buildAuthUrl, nameQuery } = await import('./googleDrive.js')

const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const REDIRECT = 'https://mealjot.com/'
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

function memoryStorage() {
  const m = new Map()
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  }
}

beforeEach(() => {
  tokens.clear()
  globalThis.sessionStorage = memoryStorage()
  globalThis.window = { location: { href: '' } }
  globalThis.fetch = vi.fn()
})

describe('googleDrive auth (token model, no client secret)', () => {
  it('builds a token-flow auth URL without PKCE or offline access', () => {
    const url = new URL(buildAuthUrl(CLIENT_ID, REDIRECT, 'abc'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('response_type')).toBe('token')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('scope')).toBe(SCOPE)
    expect(url.searchParams.get('state')).toBe('abc')
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('access_type')).toBe(false)
  })

  it('startAuth stores state and navigates to Google', async () => {
    const p = googleDriveProvider({ clientId: CLIENT_ID })
    await p.startAuth(REDIRECT)
    const url = new URL(window.location.href)
    expect(url.searchParams.get('state')).toBe(sessionStorage.getItem('google-drive_state'))
    expect(url.searchParams.get('response_type')).toBe('token')
  })

  it('completeAuth stores the fragment access token without calling the token endpoint', async () => {
    const p = googleDriveProvider({ clientId: CLIENT_ID })
    sessionStorage.setItem('google-drive_state', 's1')
    const params = new URLSearchParams({ state: 's1', access_token: 'ya29.x', expires_in: '3599', scope: SCOPE })
    await expect(p.completeAuth(params, REDIRECT)).resolves.toBe(true)
    const rec = tokens.get('google-drive')
    expect(rec.accessToken).toBe('ya29.x')
    expect(rec.refreshToken).toBeUndefined()
    expect(rec.expiresAt).toBeGreaterThan(Date.now() + 3500_000)
    expect(fetch).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('google-drive_state')).toBeNull()
  })

  it('ignores redirects whose state it did not issue (e.g. OneDrive returns)', async () => {
    const p = googleDriveProvider({ clientId: CLIENT_ID })
    sessionStorage.setItem('google-drive_state', 'mine')
    const params = new URLSearchParams({ state: 'other', code: 'c' })
    await expect(p.completeAuth(params, REDIRECT)).resolves.toBe(false)
    expect(tokens.size).toBe(0)
  })

  it('surfaces a declined consent as an error', async () => {
    const p = googleDriveProvider({ clientId: CLIENT_ID })
    sessionStorage.setItem('google-drive_state', 's1')
    const params = new URLSearchParams({ state: 's1', error: 'access_denied' })
    await expect(p.completeAuth(params, REDIRECT)).rejects.toThrow(/access_denied/)
  })

  it('rejects a token that lacks the Drive scope (unticked checkbox)', async () => {
    const p = googleDriveProvider({ clientId: CLIENT_ID })
    sessionStorage.setItem('google-drive_state', 's1')
    const params = new URLSearchParams({ state: 's1', access_token: 't', expires_in: '3599', scope: 'openid' })
    await expect(p.completeAuth(params, REDIRECT)).rejects.toThrow(/Drive access/)
    expect(tokens.size).toBe(0)
  })
})

describe('googleDrive I/O', () => {
  const p = () => googleDriveProvider({ clientId: CLIENT_ID })

  it('requires reconnect when the token is missing or expired', async () => {
    await expect(p().listRemote(p())).rejects.toThrow('reconnect-required')
    tokens.set('google-drive', { accessToken: 't', expiresAt: Date.now() - 1 })
    await expect(p().listRemote(p())).rejects.toThrow('reconnect-required')
  })

  it('clears tokens and requires reconnect on 401', async () => {
    tokens.set('google-drive', { accessToken: 't', expiresAt: Date.now() + 3600_000 })
    fetch.mockResolvedValue({ ok: false, status: 401 })
    await expect(p().listRemote(p())).rejects.toThrow('reconnect-required')
    expect(tokens.size).toBe(0)
  })

  it('lists appDataFolder files across pages with a bearer token', async () => {
    tokens.set('google-drive', { accessToken: 'tok', expiresAt: Date.now() + 3600_000 })
    fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ nextPageToken: 'n', files: [{ id: '1', name: 'goals.md', modifiedTime: '2026-01-01T00:00:00Z' }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ files: [{ id: '2', name: 'recipes.md', modifiedTime: '2026-01-02T00:00:00Z' }] }) })
    const list = await p().listRemote(p())
    expect(list.map(f => f.name)).toEqual(['goals.md', 'recipes.md'])
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toContain('spaces=appDataFolder')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(String(fetch.mock.calls[1][0])).toContain('pageToken=n')
  })

  it('creates new files inside appDataFolder', async () => {
    tokens.set('google-drive', { accessToken: 'tok', expiresAt: Date.now() + 3600_000 })
    fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ files: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'new', modifiedTime: '2026-01-03T00:00:00Z' }) })
    const res = await p().writeRemote(p(), 'entries-2026-01.md', '# hi')
    expect(res.mtime).toBe(Date.parse('2026-01-03T00:00:00Z'))
    const [url, init] = fetch.mock.calls[1]
    expect(url).toContain('/upload/drive/v3/files?uploadType=multipart')
    expect(init.method).toBe('POST')
    expect(init.body).toContain('"parents":["appDataFolder"]')
    expect(init.body).toContain('# hi')
  })

  it('escapes quotes and backslashes in name queries and skips trashed files', () => {
    expect(nameQuery("it's.md")).toBe("name='it\\'s.md' and trashed=false")
    expect(nameQuery('a\\b.md')).toBe("name='a\\\\b.md' and trashed=false")
  })
})
