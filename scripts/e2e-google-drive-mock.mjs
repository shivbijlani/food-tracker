// End-to-end check of the Google Drive sync wiring against a mocked Google.
//
// Intercepts Google's OAuth endpoint (answers with a token-model redirect,
// #access_token=...) and the Drive v3 API (an in-memory appDataFolder shared
// by every browser context), then drives the real app:
//   1. device A: connect Google Drive, log a meal -> file lands in "Drive"
//   2. device B (fresh profile): connect -> the meal is pulled back
//   3. device A: reload with an expired token -> auto-reconnect round trip
//      restores sync without user action
//
// Usage: start `VITE_GOOGLE_CLIENT_ID=e2e-client npx vite --port 5199`, then
//   node scripts/e2e-google-drive-mock.mjs [baseUrl] [screenshotDir]
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'
const { chromium } = await import('@playwright/test')

const BASE = process.argv[2] || 'http://localhost:5199/'
const OUT = process.argv[3] || '.'
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const MEAL = `e2e oatmeal ${Date.now()}`

const drive = new Map() // name -> { id, content, modifiedTime }
let nextId = 1
const log = (...a) => console.log('[e2e]', ...a)
const authRequests = []

function parseMultipart(body) {
  const boundary = body.slice(2, body.indexOf('\r\n'))
  const parts = body.split(`--${boundary}`).slice(1, -1)
  const meta = JSON.parse(parts[0].split('\r\n\r\n').slice(1).join('\r\n\r\n').trim())
  const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '')
  return { meta, content }
}

async function installGoogleMock(context, label) {
  await context.route('https://accounts.google.com/o/oauth2/v2/auth**', route => {
    const u = new URL(route.request().url())
    authRequests.push({ label, params: Object.fromEntries(u.searchParams) })
    const frag = new URLSearchParams({
      access_token: `fake-${label}-${Date.now()}`,
      token_type: 'Bearer',
      expires_in: '3599',
      scope: SCOPE,
      state: u.searchParams.get('state'),
    })
    route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}#${frag}` } })
  })
  await context.route('https://www.googleapis.com/**', async route => {
    const req = route.request()
    const u = new URL(req.url())
    const auth = req.headers()['authorization'] || ''
    if (!auth.startsWith('Bearer fake-')) return route.fulfill({ status: 401, body: '{}' })
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) })
    const idMatch = u.pathname.match(/\/files\/([^/]+)$/)
    const byId = id => [...drive.values()].find(f => f.id === id)

    if (u.pathname === '/drive/v3/files' && req.method() === 'GET') {
      if (u.searchParams.get('spaces') !== 'appDataFolder') return json({ error: 'wrong space' }, 400)
      const q = u.searchParams.get('q') || ''
      const m = q.match(/name='((?:[^'\\]|\\.)*)'/)
      const files = [...drive.entries()]
        .filter(([name]) => !m || name === m[1].replace(/\\(.)/g, '$1'))
        .map(([name, f]) => ({ id: f.id, name, modifiedTime: f.modifiedTime }))
      return json({ files })
    }
    if (idMatch && req.method() === 'GET' && u.searchParams.get('alt') === 'media') {
      const f = byId(idMatch[1])
      return f ? route.fulfill({ status: 200, contentType: 'text/plain', body: f.content }) : json({}, 404)
    }
    if (u.pathname.startsWith('/upload/drive/v3/files')) {
      const { meta, content } = parseMultipart(req.postData())
      const modifiedTime = new Date().toISOString()
      if (req.method() === 'POST') {
        if (!meta.parents?.includes('appDataFolder')) return json({ error: 'not appDataFolder' }, 400)
        const f = { id: `id${nextId++}`, content, modifiedTime }
        drive.set(meta.name, f)
        return json({ id: f.id, modifiedTime })
      }
      const f = byId(idMatch[1])
      f.content = content
      f.modifiedTime = modifiedTime
      return json({ id: f.id, modifiedTime })
    }
    if (idMatch && req.method() === 'DELETE') {
      for (const [name, f] of drive) if (f.id === idMatch[1]) drive.delete(name)
      return route.fulfill({ status: 204 })
    }
    return json({ error: `unmocked ${req.method()} ${u.pathname}` }, 500)
  })
}

async function openStorageSettings(page) {
  await page.locator('.status-badge, .settings-btn').first().click()
  await page.getByText('Access from other devices').waitFor()
}

function googleRow(page) {
  return page.locator('div', { has: page.locator('strong', { hasText: /^Google Drive$/ }) })
    .filter({ has: page.getByRole('button', { name: /^(Connect|Disconnect)$/ }) }).last()
}

async function connectGoogle(page) {
  await openStorageSettings(page)
  const row = googleRow(page)
  await row.getByRole('button', { name: 'Connect' }).click()
  await page.waitForURL(u => !u.hash.includes('access_token') && u.origin === new URL(BASE).origin, { timeout: 15000 })
  await page.waitForFunction(() => !location.hash, null, { timeout: 15000 })
  await openStorageSettings(page).catch(() => {})
  await row.getByText(/Connected/).waitFor({ timeout: 15000 })
}

async function waitFor(pred, what, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await pred()) return
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const browser = await chromium.launch()
const errors = []
try {
  // ---- Device A: connect + log a meal ----
  const ctxA = await browser.newContext()
  await installGoogleMock(ctxA, 'A')
  const a = await ctxA.newPage()
  a.on('pageerror', e => errors.push(`A: ${e.message}`))
  await a.goto(BASE)
  await a.getByPlaceholder(/2 eggs/).waitFor()
  await connectGoogle(a)
  log('A connected; auth request params:', JSON.stringify(authRequests[0].params))
  if (authRequests[0].params.response_type !== 'token') throw new Error('expected token-model auth')
  await googleRow(a).scrollIntoViewIfNeeded()
  await a.screenshot({ path: `${OUT}/e2e-1-connected.png` })
  await a.keyboard.press('Escape')
  await a.locator('.settings-modal-backdrop').click({ position: { x: 5, y: 5 } }).catch(() => {})

  await a.getByPlaceholder(/2 eggs/).fill(MEAL)
  await a.getByRole('button', { name: /Quick add/ }).click()
  const month = new Date().toISOString().slice(0, 7)
  const entriesFile = `entries-${month}.md`
  await waitFor(() => drive.get(entriesFile)?.content.includes(MEAL), `${entriesFile} with meal in Drive`)
  log(`A pushed ${entriesFile} to Drive:`, [...drive.keys()].join(', '))
  await a.screenshot({ path: `${OUT}/e2e-2-logged.png` })

  // ---- Device B: fresh profile pulls it back ----
  const ctxB = await browser.newContext()
  await installGoogleMock(ctxB, 'B')
  const b = await ctxB.newPage()
  b.on('pageerror', e => errors.push(`B: ${e.message}`))
  await b.goto(BASE)
  await b.getByPlaceholder(/2 eggs/).waitFor()
  const before = await b.evaluate(k => localStorage.getItem(k), `ft-file:${entriesFile}`)
  if (before?.includes(MEAL)) throw new Error('fresh profile unexpectedly already has the meal')
  await connectGoogle(b)
  await waitFor(async () => (await b.evaluate(k => localStorage.getItem(k), `ft-file:${entriesFile}`))?.includes(MEAL),
    'meal pulled into fresh profile')
  await b.keyboard.press('Escape')
  await b.reload()
  await b.getByText(MEAL).first().waitFor({ timeout: 15000 })
  await b.getByText(MEAL).first().scrollIntoViewIfNeeded()
  log('B (fresh profile) pulled the meal back from Drive and renders it')
  await b.screenshot({ path: `${OUT}/e2e-3-pulled.png` })

  // ---- Device A: token expired + reload -> silent auto-reconnect ----
  await a.evaluate(() => new Promise((res, rej) => {
    const open = indexedDB.open('folder-sync')
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('tokens', 'readwrite')
      const st = tx.objectStore('tokens')
      const g = st.get('google-drive')
      g.onsuccess = () => { st.put({ ...g.result, expiresAt: Date.now() - 1000 }, 'google-drive') }
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    }
    open.onerror = () => rej(open.error)
  }))
  const authBefore = authRequests.length
  await a.reload()
  await waitFor(() => authRequests.length > authBefore, 'auto-reconnect auth request after reload')
  await a.waitForFunction(() => !location.hash, null, { timeout: 15000 })
  await a.getByPlaceholder(/2 eggs/).waitFor()
  const MEAL2 = `${MEAL} (after reconnect)`
  await a.getByPlaceholder(/2 eggs/).fill(MEAL2)
  await a.getByRole('button', { name: /Quick add/ }).click()
  await waitFor(() => drive.get(entriesFile)?.content.includes(MEAL2), 'post-reconnect write in Drive')
  log('A auto-reconnected after reload with an expired token and kept syncing')
  await openStorageSettings(a)
  await googleRow(a).scrollIntoViewIfNeeded()
  await a.screenshot({ path: `${OUT}/e2e-4-reconnected.png` })

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`)
  log('PASS')
} catch (e) {
  console.error('[e2e] FAIL', e)
  process.exitCode = 1
} finally {
  await browser.close()
}
