import assert from 'node:assert/strict'
import { FOODS, RECIPES, mockGraph } from '../packages/food-tools/test/fixtures.mjs'
import { readEntries } from '../packages/food-tools/src/mdyaml.js'
import { DAILY_LOG_HEADERS, PROTEIN_LOG_HEADERS } from '../packages/food-tools/src/markdown.js'

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'
const { chromium } = await import('@playwright/test')
const base = process.argv[2] || 'http://localhost:5197'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const mode of ['advanced', 'simple']) {
    const context = await browser.newContext()
    const graph = mockGraph({ forceConflict: true })
    await context.route('https://graph.microsoft.com/**', async route => {
      const req = route.request()
      const headers = req.headers()
      const init = { method: req.method(), headers: {
        Authorization: headers.authorization,
        'If-Match': headers['if-match'], 'If-None-Match': headers['if-none-match'],
      }, body: req.postData() }
      if (init.method === 'GET') delete init.method
      // Preserve the existing non-log suggestion sync path in this mock.
      if (init.method === 'PUT' && req.url().includes('suggestions.csv')) {
        graph.files.set('suggestions.csv', req.postData())
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lastModifiedDateTime: new Date().toISOString() }) })
      }
      const response = await graph.fetchImpl(req.url(), init)
      return route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json' })
    })
    await context.route('https://download.test/**', async route => {
      const response = await graph.fetchImpl(route.request().url())
      await route.fulfill({ status: response.status, body: await response.text(), contentType: 'text/plain' })
    })
    await context.addInitScript(({ mode, foods, recipes }) => {
      if (localStorage.getItem('synthetic-seed')) return
      localStorage.setItem('synthetic-seed', '1')
      localStorage.setItem('mealjot-mode', mode)
      localStorage.setItem('ft-file:suggestions.csv', foods)
      localStorage.setItem('ft-file:recipes.md', recipes)
    }, { mode, foods: FOODS, recipes: RECIPES })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base)
    const input = page.getByPlaceholder(/e.g. 2 eggs/).first()
    await input.fill('Greek yogurt')
    await page.locator('.suggestion-item').filter({ hasText: /^Greek yogurt/ }).click()
    await page.getByRole('button', { name: mode === 'advanced' ? 'Save all' : 'Save', exact: true }).click()
    await page.waitForFunction(mode => [...Object.keys(localStorage)].some(k =>
      k.startsWith(mode === 'advanced' ? 'ft-file:entries-' : 'ft-file:protein-') &&
      localStorage.getItem(k).includes('Greek yogurt')), mode)
    const key = await page.evaluate(mode => Object.keys(localStorage).find(k => k.startsWith(mode === 'advanced' ? 'ft-file:entries-' : 'ft-file:protein-')), mode)
    const before = readEntries(await page.evaluate(k => localStorage.getItem(k), key), mode === 'advanced' ? DAILY_LOG_HEADERS : PROTEIN_LOG_HEADERS).rows
    assert.equal(before.length, 1)
    assert.equal(before[0]['Protein (g)'], '20')
    assert.ok(before[0].Id)
    await page.reload()
    await page.waitForSelector('.app-title')
    const reread = readEntries(await page.evaluate(k => localStorage.getItem(k), key), mode === 'advanced' ? DAILY_LOG_HEADERS : PROTEIN_LOG_HEADERS).rows
    assert.equal(reread[0].Id, before[0].Id)
    await page.evaluate(async () => {
      const { setTokens } = await import('/folder-sync/auth/tokenStore.js')
      await setTokens('onedrive', { accessToken: 'synthetic-browser-token', expiresAt: Date.now() + 3600000 })
      localStorage.setItem('folder-sync:intended-providers', '["onedrive"]')
      const regs = await navigator.serviceWorker.getRegistrations()
      const reg = regs.find(r => r.scope.includes('/folder-sync/'))
      if (!reg?.active) throw new Error('Sync worker not ready')
      reg.active.postMessage({ type: 'sync', reason: 'synthetic-e2e', providers: [{ id: 'onedrive', clientId: '94f25f67-e08b-415e-b1aa-4159093d401d' }] })
    })
    await page.waitForFunction(k => localStorage.getItem(k)?.includes('Concurrent food'), key, { timeout: 15000 })
    const synced = readEntries(graph.files.get(key.replace('ft-file:', '')), mode === 'advanced' ? DAILY_LOG_HEADERS : PROTEIN_LOG_HEADERS).rows
    assert.equal(synced.length, 2)
    assert.ok(synced.some(r => r.Id === before[0].Id))
    const puts = graph.requests.filter(r => r.method === 'PUT')
    assert.ok(puts.some(r => r.headers['If-Match'] === '1'))
    assert.ok(puts.some(r => r.headers['If-Match'] === '2'))
    await page.getByRole('button', { name: 'Synced to cloud', exact: true }).waitFor()
    await context.route('https://graph.microsoft.com/**', route => route.fulfill({ status: 403, body: '{}' }))
    await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations()
      regs.find(r => r.scope.includes('/folder-sync/')).active.postMessage({
        type: 'sync', reason: 'synthetic-access-denied',
        providers: [{ id: 'onedrive', clientId: '94f25f67-e08b-415e-b1aa-4159093d401d' }],
      })
    })
    await page.getByRole('button', { name: /Cloud sync failed/ }).waitFor()
    assert.deepEqual(errors, [])
    console.log(`${mode}: UI saved shared suggestion, stable ID survived reload, worker merged forced 412/concurrent food and surfaced access-denied sync error.`)
    await context.close()
  }
} finally {
  await browser.close()
}
