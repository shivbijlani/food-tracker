import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createTools } from '../src/tools.js'
import { oneDriveStore } from '../src/onedrive.js'
import { readEntries, writeEntries } from '../src/mdyaml.js'
import { DAILY_LOG_HEADERS, PROTEIN_LOG_HEADERS } from '../src/markdown.js'
import { addLogEntries, updateEntryAt } from '../src/mergeEntry.js'
import { composeSuggestions, parseSuggestions } from '../src/suggestions.js'
import { mergeLogSnapshots } from '../src/logSync.js'
import { protocol } from '../src/protocol.js'
import { environmentAuth, deviceAuth } from '../src/auth.js'
import { planTool } from '../src/planner.js'
import { MemoryStore, mockGraph, FOODS, RECIPES, CONCURRENT } from './fixtures.mjs'

const args = preparation => ({
  preparation, date: '2026-10-12', meal: 'Breakfast', operationId: `${preparation.mode}:2026-10-12:test-op-001`,
  selections: preparation.items.map(item => ({ optionId: item.options[0].optionId, quantity: 2 })),
})

test('shared UI catalog matches preparation, including halves and recipe portions in both modes', async () => {
  for (const mode of ['simple', 'advanced']) {
    const store = new MemoryStore(), tools = createTools(store)
    const prep = await tools.prepare_food_log({ mode, items: ['Chili', 'Greek yogurt'] })
    const ui = composeSuggestions(readEntries(RECIPES).rows, parseSuggestions(FOODS), mode)
    assert.deepEqual(prep.items[0].options.map(o => o.name), ui.filter(o => o.name.includes('Chili')).map(o => o.name))
    assert.equal(store.writes, 0)
    const result = await tools.commit_food_log(args(prep))
    const day = await tools.get_day({ date: '2026-10-12', mode })
    assert.equal(day.entries.length, 2)
    assert.equal(result.entryIds.length, 2)
    assert.equal(day.entries[1]['Protein (g)'], mode === 'advanced' ? '25' : '50')
    assert.equal(store.files.get('suggestions.csv'), FOODS)
  }
})

test('zero nutrition remains known in half portions, and recipe source wins its own portion', async () => {
  const store = new MemoryStore()
  store.files.set('suggestions.csv', FOODS + 'Water,0,0,0,0,N\n1 serving of Chili,999,999,,,\n')
  const prep = await createTools(store).prepare_food_log({ items: ['Water', '1 serving of Chili'] })
  assert.equal(prep.items[0].options[1].nutrition.protein_g, '0')
  assert.equal(prep.items[0].options[1].nutrition.calories, 0)
  assert.equal(prep.items[1].options[0].nutrition.protein_g, '25')
  assert.deepEqual(prep.items[1].options[0].source, { file: 'recipes.md', name: 'Chili' })
})

test('412 retry freshly reapplies operation without losing concurrent row or legacy IDs', async () => {
  const store = new MemoryStore(), tools = createTools(store)
  const legacy = '| Date | Meal | Food Description | Protein (g) |\n|---|---|---|---|\n| 2026-10-12 | Lunch | Legacy food | 3 |\n'
  store.files.set('entries-2026-10.md', legacy)
  const id = readEntries(legacy, DAILY_LOG_HEADERS).rows[0].Id
  store.beforeWrite = name => store.files.set(name, writeEntries(legacy, DAILY_LOG_HEADERS, [...readEntries(legacy, DAILY_LOG_HEADERS).rows, CONCURRENT]))
  const prep = await tools.prepare_food_log({ items: ['Greek yogurt'] })
  await tools.commit_food_log(args(prep))
  const day = await tools.get_day({ date: '2026-10-12' })
  assert.equal(day.entries.length, 3)
  assert.ok(day.entries.some(e => e.Id === id))
  assert.ok(day.entries.some(e => e.Id === 'concurrent-id'))
  assert.equal(store.writes, 2)
})

test('duplicate ID is durable after UI edit/delete, and different request conflicts', async () => {
  const store = new MemoryStore(), tools = createTools(store)
  const prep = await tools.prepare_food_log({ items: ['Greek yogurt'] })
  const request = args(prep)
  const first = await tools.commit_food_log(request)
  const text = store.files.get(first.file)
  const edited = updateEntryAt(readEntries(text, DAILY_LOG_HEADERS).rows, 0, { Date: '2026-10-12', Meal: 'Snack', 'Food Description': 'Edited' })
  assert.equal(edited[0].Id, first.entryIds[0])
  store.files.set(first.file, writeEntries(text, DAILY_LOG_HEADERS, []))
  store.files.set('suggestions.csv', FOODS + 'Toast,3,50,,,\n')
  assert.equal((await tools.commit_food_log(request)).duplicate, true)
  assert.equal((await tools.get_day({ date: request.date })).entries.length, 0)
  await assert.rejects(tools.commit_food_log({ ...request, meal: 'Lunch' }), { code: 'OPERATION_CONFLICT' })
})

test('stale and tampered preparation cannot override saved nutrition', async () => {
  const store = new MemoryStore(), tools = createTools(store)
  const prep = await tools.prepare_food_log({ items: ['Greek yogurt'] })
  prep.items[0].options[0].nutrition.protein_g = 999
  await tools.commit_food_log(args(prep))
  assert.equal((await tools.get_day({ date: '2026-10-12' })).totals.protein_g.known, 40)
  store.files.set('suggestions.csv', FOODS.replace('20,120', '30,120'))
  await assert.rejects(tools.commit_food_log({ ...args(prep), operationId: 'advanced:2026-10-12:new-operation' }), { code: 'STALE_PREPARATION' })
})

test('new food is explicit, unknown stays unknown, estimates are labeled, catalog unchanged', async () => {
  const store = new MemoryStore(), tools = createTools(store)
  const prep = await tools.prepare_food_log({ items: ['Mystery food', 'Estimated food'] })
  const request = { ...args({ ...prep, items: [] }), preparation: prep, selections: [
    { newFood: { name: 'Mystery food', nutritionStatus: 'unknown' }, quantity: 1 },
    { newFood: { name: 'Estimated food', nutritionStatus: 'estimated', nutrition: { protein_g: 5 } }, quantity: 2 },
  ] }
  await tools.commit_food_log(request)
  const day = await tools.get_day({ date: request.date })
  assert.deepEqual(day.totals.protein_g, { known: 10, unknownEntries: 1, complete: false })
  assert.ok(day.entries[0].Notes.includes('estimated'))
  assert.equal(store.files.get('suggestions.csv'), FOODS)
  await assert.rejects(tools.commit_food_log({ ...request, operationId: 'advanced:2026-10-12:invalid-new', selections: [{ quantity: 1 }, request.selections[1]] }), { code: 'INVALID_INPUT' })
  await assert.rejects(tools.get_day({ date: '2026-02-30' }), { code: 'INVALID_INPUT' })
})

test('legacy duplicates have stable distinct IDs, UI writes retain IDs and receipt metadata', () => {
  const text = '| Date | Meal | Protein (g) |\n|---|---|---|\n| 2026-10-12 | Eggs | 12 |\n| 2026-10-12 | Eggs | 12 |\n'
  const rows = readEntries(text, PROTEIN_LOG_HEADERS).rows
  assert.notEqual(rows[0].Id, rows[1].Id)
  assert.deepEqual(readEntries(text, PROTEIN_LOG_HEADERS).rows, rows)
  const saved = writeEntries(text, PROTEIN_LOG_HEADERS, addLogEntries(rows, [{ Date: '2026-10-12', Meal: 'Bread', 'Protein (g)': '4' }]), { foodOperations: ['receipt'] })
  const reread = readEntries(saved, PROTEIN_LOG_HEADERS)
  assert.equal(reread.rows[1].Id, rows[0].Id)
  assert.deepEqual(readEntries(writeEntries(saved, PROTEIN_LOG_HEADERS, reread.rows), PROTEIN_LOG_HEADERS).meta.foodOperations, ['receipt'])
})

test('UI cloud sync three-way merge preserves agent additions and receipts, applies UI deletion, rejects conflicting edits', () => {
  const base = writeEntries('', DAILY_LOG_HEADERS, [CONCURRENT])
  const local = writeEntries(base, DAILY_LOG_HEADERS, [])
  const remote = writeEntries(base, DAILY_LOG_HEADERS, [CONCURRENT, { ...CONCURRENT, Id: 'agent-id', 'Food Description': 'Agent food' }], { foodOperations: ['agent-receipt'] })
  const merged = readEntries(mergeLogSnapshots(base, local, remote, 'advanced'), DAILY_LOG_HEADERS)
  assert.deepEqual(merged.rows.map(r => r.Id), ['agent-id'])
  assert.deepEqual(merged.meta.foodOperations, ['agent-receipt'])
  const left = writeEntries(base, DAILY_LOG_HEADERS, [{ ...CONCURRENT, Meal: 'Dinner' }])
  const right = writeEntries(base, DAILY_LOG_HEADERS, [{ ...CONCURRENT, Meal: 'Snack' }])
  assert.throws(() => mergeLogSnapshots(base, left, right, 'advanced'), { code: 'SYNC_CONFLICT' })
  assert.equal(mergeLogSnapshots(null, null, base, 'advanced'), base)
})

test('Graph store conditional create/write, forced 412, fresh metadata, no bearer forwarded to download', async () => {
  const mock = mockGraph({ forceConflict: true })
  const store = oneDriveStore({ getAccessToken: async () => 'synthetic-test-token', fetchImpl: mock.fetchImpl })
  const tools = createTools(store), prep = await tools.prepare_food_log({ items: ['Greek yogurt'] })
  await tools.commit_food_log(args(prep))
  assert.equal((await tools.get_day({ date: '2026-10-12' })).entries.length, 2)
  const puts = mock.requests.filter(r => r.method === 'PUT')
  assert.deepEqual(puts.map(p => p.headers['If-Match']), ['1', '2'])
  assert.ok(puts[1].body.includes('Concurrent food'))
  const reserve = mock.requests.find(r => r.method === 'POST')
  assert.equal(JSON.parse(reserve.body)['@microsoft.graph.conflictBehavior'], 'fail')
})

test('explicit Graph errors do not echo tokens, bodies or account details', async () => {
  for (const status of [401, 403, 500]) {
    const tools = createTools(oneDriveStore({ getAccessToken: async () => 'DO-NOT-PRINT', fetchImpl: async () => new Response('DO-NOT-PRINT', { status }) }))
    const rpc = protocol({ read: async () => { await tools.get_day({ date: '2026-10-12' }) } })
    const result = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_day', arguments: { date: '2026-10-12' } } })
    assert.equal(result.result.isError, true)
    assert.ok(!JSON.stringify(result).includes('DO-NOT-PRINT'))
  }
})

test('CLI and stdio MCP processes use same routes; forced 412 survives through adapter', async () => {
  const prep = await createTools(new MemoryStore()).prepare_food_log({ items: ['Greek yogurt'] })
  const bin = fileURLToPath(new URL('../bin/mealjot.js', import.meta.url))
  const preload = new URL('./preload.mjs', import.meta.url).href
  const run = (command, input) => spawnSync(process.execPath, ['--import', preload, bin, command], {
    input, encoding: 'utf8', env: { ...process.env, MEALJOT_ACCESS_TOKEN: 'synthetic-test-token', MEALJOT_TEST_CONFLICT: '1' },
  })
  const cli = run('commit_food_log', JSON.stringify(args(prep)))
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).entries[0]['Protein (g)'], '40')
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'prepare_food_log', arguments: { items: ['Greek yogurt'] } } },
    ...[4, 5].map(id => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'commit_food_log', arguments: args(prep) } })),
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_day', arguments: { date: '2026-10-12' } } },
  ]
  const mcp = run('mcp', messages.map(m => JSON.stringify(m)).join('\n') + '\n')
  assert.equal(mcp.status, 0, mcp.stderr)
  const replies = mcp.stdout.trim().split('\n').map(JSON.parse)
  assert.equal(replies[1].result.tools.length, 3)
  assert.equal(replies[2].result.structuredContent.catalogRevision, prep.catalogRevision)
  assert.equal(replies[4].result.structuredContent.duplicate, true)
  assert.equal(replies[5].result.structuredContent.entries.length, 2)
  assert.ok(!mcp.stdout.includes('synthetic-test-token'))
})

test('auth token stays in memory, and device flow errors redact provider responses', async () => {
  const env = { MEALJOT_ACCESS_TOKEN: 'synthetic-test-token' }
  const getToken = environmentAuth(env)
  assert.equal(env.MEALJOT_ACCESS_TOKEN, undefined)
  assert.equal(await getToken(), 'synthetic-test-token')
  await assert.rejects(deviceAuth({ fetchImpl: async () => new Response(JSON.stringify({ error: 'unauthorized_client', error_description: 'SECRET' })), notify: () => {} }), { code: 'AUTH_UNAVAILABLE' })
})

test('tokenless broker plans reuse shared code, fresh-replan after 412, verify receipt and dedupe', async () => {
  const graph = mockGraph({ forceConflict: true })
  const brokerReader = oneDriveStore({ getAccessToken: async () => 'synthetic-broker-token', fetchImpl: graph.fetchImpl })
  const plan = async (tool, arguments_) => {
    const snapshots = {}
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await planTool({ tool, arguments: arguments_, snapshots })
      if (result.state !== 'read_required') return result
      for (const read of result.reads) snapshots[read.filename] = await brokerReader.read(read.filename)
    }
    throw new Error('too many reads')
  }
  const prepared = await plan('prepare_food_log', { items: ['Greek yogurt'] })
  assert.equal(prepared.state, 'read_complete')
  const request = args(prepared.result)
  let written = await plan('commit_food_log', request)
  assert.equal(written.state, 'write_required')
  assert.equal(written.result, undefined)
  assert.equal(written.write.request.headers['If-None-Match'], '*')
  const execute = write => graph.fetchImpl(write.request.url, {
    ...write.request, headers: { ...write.request.headers, Authorization: 'Bearer synthetic-broker-token' },
  })
  assert.equal((await execute(written.write)).status, 412)
  written = await plan('commit_food_log', request)
  assert.equal(written.state, 'write_required')
  assert.ok(written.write.request.headers['If-Match'])
  assert.ok(written.write.request.body.includes('Concurrent food'))
  assert.equal((await execute(written.write)).status, 200)
  const verified = await plan('commit_food_log', request)
  assert.equal(verified.state, 'already_applied')
  assert.equal(verified.result.duplicate, true)
  assert.equal((await plan('get_day', { date: request.date })).result.entries.length, 2)
  assert.ok(!JSON.stringify(written).includes('synthetic-broker-token'))
})

test('broker rejects stale catalog, missing snapshot versions and wrong operations', async () => {
  const store = new MemoryStore()
  const prep = await createTools(store).prepare_food_log({ items: ['Greek yogurt'] })
  const snapshots = Object.fromEntries([...store.files].map(([name, content]) => [name, { content, id: name, etag: '1' }]))
  snapshots['entries-2026-10.md'] = { content: null, etag: null, id: null }
  snapshots['suggestions.csv'].content = FOODS + 'Bread,4,80,,,\n'
  await assert.rejects(planTool({ tool: 'commit_food_log', arguments: args(prep), snapshots }), { code: 'STALE_PREPARATION' })
  snapshots['suggestions.csv'].etag = null
  await assert.rejects(planTool({ tool: 'prepare_food_log', arguments: { items: ['Greek yogurt'] }, snapshots }), { code: 'INVALID_INPUT' })
  await assert.rejects(planTool({ tool: 'arbitrary_http', snapshots }), { code: 'INVALID_INPUT' })
})

test('tokenless broker CLI/MCP start without a token and emit no write-success claims', async () => {
  const bin = fileURLToPath(new URL('../bin/mealjot.js', import.meta.url))
  const input = { tool: 'prepare_food_log', arguments: { items: ['Greek yogurt'] } }
  const cli = spawnSync(process.execPath, [bin, 'plan'], { input: JSON.stringify(input), encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).state, 'read_required')
  const rpc = protocol(null, { brokerMode: true })
  const listed = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.equal(listed.result.tools[0].name, 'mealjot_plan')
  const mcp = spawnSync(process.execPath, [bin, 'mcp', '--broker'], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mealjot_plan', arguments: input } }) + '\n',
    encoding: 'utf8',
  })
  assert.equal(mcp.status, 0, mcp.stderr)
  assert.equal(JSON.parse(mcp.stdout).result.structuredContent.state, 'read_required')
})
