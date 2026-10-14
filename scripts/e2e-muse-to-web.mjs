// End-to-end: a food logged by an agent (Muse) through the MealJot tools must
// show up in the MealJot web app connected to the same OneDrive AppFolder.
//
//   npx vite --port 5197 &  node scripts/e2e-muse-to-web.mjs http://localhost:5197
import assert from 'node:assert/strict'
import { FOODS, RECIPES, mockGraph } from '../packages/food-tools/test/fixtures.mjs'
import { oneDriveStore } from '../packages/food-tools/src/onedrive.js'
import { createTools } from '../packages/food-tools/src/tools.js'
import { writeEntries } from '../packages/food-tools/src/mdyaml.js'
import { PROTEIN_LOG_HEADERS, DAILY_LOG_HEADERS } from '../packages/food-tools/src/markdown.js'

const { chromium } = await import('@playwright/test')
const base = process.argv[2] || 'http://localhost:5197'
const CLIENT_ID = '94f25f67-e08b-415e-b1aa-4159093d401d'
const d = new Date()
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const browser = await chromium.launch({ channel: 'msedge', headless: true })

async function wireGraph(context, graph) {
  await context.route('https://graph.microsoft.com/**', async route => {
    const req = route.request()
    const h = req.headers()
    const init = { method: req.method(), headers: { Authorization: h.authorization, 'If-Match': h['if-match'], 'If-None-Match': h['if-none-match'] }, body: req.postData() }
    if (init.method === 'GET') delete init.method
    if (init.method === 'PUT' && !req.url().includes('/items/') && !/(entries|protein)-/.test(req.url())) {
      const name = decodeURIComponent(req.url().split('approot:/')[1].split(':/content')[0])
      graph.files.set(name, req.postData())
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lastModifiedDateTime: new Date().toISOString() }) })
    }
    if (init.method !== 'PUT' && !init.method && /approot:\/[^?]+:\/content/.test(req.url())) {
      const name = decodeURIComponent(req.url().split('approot:/')[1].split(':/content')[0])
      return route.fulfill({ status: graph.files.has(name) ? 200 : 404, body: graph.files.get(name) ?? '', contentType: 'text/plain' })
    }
    const res = await graph.fetchImpl(req.url(), init)
    return route.fulfill({ status: res.status, body: await res.text(), contentType: 'application/json' })
  })
  await context.route('https://download.test/**', async route => {
    const res = await graph.fetchImpl(route.request().url())
    await route.fulfill({ status: res.status, body: await res.text(), contentType: 'text/plain' })
  })
}

const sync = page => page.evaluate(async clientId => {
  const regs = await navigator.serviceWorker.getRegistrations()
  const reg = regs.find(r => r.scope.includes('/folder-sync/'))
  if (!reg?.active) throw new Error('Sync worker not ready')
  reg.active.postMessage({ type: 'sync', reason: 'e2e', providers: [{ id: 'onedrive', clientId }] })
}, CLIENT_ID)

try {
  for (const mode of ['simple', 'advanced']) {
    const file = `${mode === 'simple' ? 'protein' : 'entries'}-${today.slice(0, 7)}.md`
    const headers = mode === 'simple' ? PROTEIN_LOG_HEADERS : DAILY_LOG_HEADERS
    const graph = mockGraph()
    // A food the user previously logged on the website, already in OneDrive.
    graph.files.set(file, writeEntries('', headers, [{ Date: today, Meal: mode === 'simple' ? 'Website toast' : 'Breakfast', 'Food Description': 'Website toast', 'Protein (g)': '5', Id: 'web-1' }], { kind: 'entries', mode, period: today.slice(0, 7) }))
    const context = await browser.newContext()
    await wireGraph(context, graph)
    await context.addInitScript(({ mode, foods, recipes }) => {
      if (localStorage.getItem('synthetic-seed')) return
      localStorage.setItem('synthetic-seed', '1')
      localStorage.setItem('mealjot-mode', mode)
      localStorage.setItem('ft-file:suggestions.csv', foods)
      localStorage.setItem('ft-file:recipes.md', recipes)
    }, { mode, foods: FOODS, recipes: RECIPES })
    const page = await context.newPage()
    await page.clock.install()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base)
    await page.waitForSelector('.app-title')
    await page.waitForFunction(() => navigator.serviceWorker.getRegistrations().then(r => r.some(x => x.active && x.scope.includes('/folder-sync/'))))
    await page.evaluate(async () => {
      const { setTokens } = await import('/folder-sync/auth/tokenStore.js')
      await setTokens('onedrive', { accessToken: 'synthetic-browser-token', expiresAt: Date.now() + 3600000 })
      localStorage.setItem('folder-sync:intended-providers', '["onedrive"]')
    })
    await sync(page)
    await page.getByText('Website toast').first().waitFor({ timeout: 15000 })
    assert.equal(await page.getByText('Greek yogurt').count(), 0, 'Greek yogurt visible before Muse logged it')

    // Muse logs a food through the released tools against the same OneDrive.
    const tools = createTools(oneDriveStore({ getAccessToken: async () => 'muse-token', fetchImpl: graph.fetchImpl }))
    const prep = await tools.prepare_food_log({ mode, items: ['Greek yogurt'] })
    const opt = prep.items[0].options.find(o => o.name === 'Greek yogurt')
    await tools.commit_food_log({ preparation: prep, selections: [{ optionId: opt.optionId, quantity: 1 }], date: today, meal: 'Snack', operationId: `${mode}:${today}:muse-e2e-operation-1` })

    // Coming back to an already-open tab triggers the app's own sync; the UI must update without reload.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByText('Greek yogurt').first().waitFor({ timeout: 15000 })
    await page.getByText('Website toast').first().waitFor()

    // A fresh visit (new tab) must also show it.
    await page.reload()
    await page.getByText('Greek yogurt').first().waitFor({ timeout: 15000 })

    // With the tab left open and visible (no focus change), a later Muse log appears via polling.
    const prep2 = await tools.prepare_food_log({ mode, items: ['Apple'] })
    await tools.commit_food_log({ preparation: prep2, selections: [{ optionId: prep2.items[0].options.find(o => o.name === 'Apple').optionId, quantity: 1 }], date: today, meal: 'Snack', operationId: `${mode}:${today}:muse-e2e-operation-2` })
    assert.equal(await page.getByText(/\bApple\b/).count(), 0, 'Apple visible before poll')
    await page.clock.fastForward('01:05')
    await page.getByText(/\bApple\b/).first().waitFor({ timeout: 15000 })

    // OneDrive keeps both the website row and Muse's row.
    const rows = (await import('../packages/food-tools/src/mdyaml.js')).readEntries(graph.files.get(file), headers).rows
    assert.ok(rows.some(r => (r['Food Description'] || r.Meal) === 'Greek yogurt'))
    assert.ok(rows.some(r => r.Id === 'web-1'))
    assert.deepEqual(errors, [])
    console.log(`${mode}: Muse-logged food appeared on the website (live sync + reload).`)
    await context.close()
  }
} finally {
  await browser.close()
}
