import { describe, it, expect } from 'vitest'
import { resolveWholeFile, syncProviderFiles } from './fileSync.js'
import { mergeLogSnapshots } from '../../food-tools/src/logSync.js'
import { readEntries, writeEntries } from '../../food-tools/src/mdyaml.js'
import { PROTEIN_LOG_HEADERS } from '../../food-tools/src/markdown.js'

const LOG = 'protein-2026-10.md'
const row = (id, meal, protein) => ({ Date: '2026-10-12', Meal: meal, 'Protein (g)': protein, Notes: '', Id: id })
const log = rows => writeEntries('', PROTEIN_LOG_HEADERS, rows, { kind: 'entries', mode: 'simple' })
const rowsOf = text => readEntries(text, PROTEIN_LOG_HEADERS).rows.map(r => `${r.Id}:${r.Meal}:${r['Protein (g)']}`).sort()

// In-memory provider: whole-file + versioned API, with call counters.
function fakeProvider(id, files = {}, { versioned = true } = {}) {
  const store = new Map(Object.entries(files).map(([n, f]) => [n, { ...f, rev: 1 }]))
  const calls = { read: 0, write: 0, readVersioned: 0, writeVersioned: 0, delete: 0 }
  let clock = 1000
  const put = (name, content) => {
    const prev = store.get(name)
    store.set(name, { content, mtime: ++clock, rev: (prev?.rev || 0) + 1 })
  }
  const p = {
    id, store, calls, put,
    listRemote: async () => [...store].map(([name, f]) => ({ name, mtime: f.mtime, rev: f.rev })),
    readRemote: async (_c, name) => { calls.read++; return store.get(name)?.content ?? null },
    writeRemote: async (_c, name, content) => { calls.write++; put(name, content); return { mtime: clock, rev: store.get(name).rev } },
    deleteRemote: async (_c, name) => { calls.delete++; store.delete(name) },
  }
  if (versioned) {
    p.readVersioned = async name => {
      calls.readVersioned++
      const f = store.get(name)
      return f ? { content: f.content, id: name, version: f.rev } : { content: null, id: null, version: null }
    }
    p.writeVersioned = async (name, content, snap) => {
      calls.writeVersioned++
      if ((store.get(name)?.rev ?? null) !== snap.version) {
        const e = new Error('changed'); e.code = 'PRECONDITION_FAILED'; throw e
      }
      put(name, content)
    }
  }
  return p
}

function fakeLocal(files = {}) {
  const local = new Map(Object.entries(files))
  const meta = new Map()
  const io = {
    local, meta,
    readLocal: async name => local.has(name) ? local.get(name) : null,
    replaceLocal: async (name, expected, content, mtime = Date.now()) => {
      if ((local.get(name)?.content ?? null) !== expected) return false
      local.set(name, { content, mtime })
      return true
    },
    listLocal: async () => [...local.keys()],
    getMeta: async key => meta.get(key),
    setMeta: async (key, value) => { meta.set(key, value) },
    mergeFoodLog: (base, l, r, name) => mergeLogSnapshots(base, l, r, name.startsWith('protein-') ? 'simple' : 'advanced'),
  }
  return io
}

describe('resolveWholeFile', () => {
  it('takes whichever side changed against the base', () => {
    expect(resolveWholeFile({ base: 'a', local: 'b', remote: 'a' })).toBe('b')
    expect(resolveWholeFile({ base: 'a', local: 'a', remote: 'c' })).toBe('c')
  })
  it('propagates a local delete only when the remote is unchanged', () => {
    expect(resolveWholeFile({ base: 'a', local: null, remote: 'a' })).toBe(null)
    expect(resolveWholeFile({ base: 'a', local: null, remote: 'c' })).toBe('c')
  })
  it('never deletes local because a remote copy is missing', () => {
    expect(resolveWholeFile({ base: 'a', local: 'a', remote: null })).toBe('a')
  })
  it('first sync (no base) keeps the newer copy, so a stale remote loses', () => {
    expect(resolveWholeFile({ base: undefined, local: 'new', remote: 'old', localMtime: 200, remoteMtime: 100 })).toBe('new')
    expect(resolveWholeFile({ base: undefined, local: 'old', remote: 'new', localMtime: 100, remoteMtime: 200 })).toBe('new')
  })
})

describe('syncProviderFiles with a stale second provider', () => {
  // Production repro: the local mirror was older than both clouds; Google
  // synced first and its stale copy was stamped "now", then beat OneDrive.
  it('a stale copy pulled from one provider never looks newer than another provider', async () => {
    const io = fakeLocal({ 'goals.md': { content: 'mirror junk', mtime: 10 } })
    const google = fakeProvider('google-drive', { 'goals.md': { content: 'stale google', mtime: 100 } })
    const onedrive = fakeProvider('onedrive', { 'goals.md': { content: 'current onedrive', mtime: 200 } })

    await syncProviderFiles(google, io)
    await syncProviderFiles(onedrive, io)
    await syncProviderFiles(google, io)
    await syncProviderFiles(onedrive, io)

    expect(onedrive.store.get('goals.md').content).toBe('current onedrive')
    expect(google.store.get('goals.md').content).toBe('current onedrive')
    expect(io.local.get('goals.md').content).toBe('current onedrive')
  })

  it('first sync of the food catalog keeps rows from both copies', async () => {
    const header = 'name,protein_g,calories,calcium_mg,veg_servings,omega3'
    const io = fakeLocal({ 'suggestions.csv': { content: `${header}\nTest oatmeal,,,,,N\n`, mtime: 9999 } })
    const onedrive = fakeProvider('onedrive', {
      'suggestions.csv': { content: `${header}\n2 eggs,14,140,56,0,N\n"Tuna, canned",20,,,,Y\n`, mtime: 1 },
    })

    await syncProviderFiles(onedrive, io)

    const rows = onedrive.store.get('suggestions.csv').content.trim().split('\n')
    expect(rows).toEqual([header, 'Test oatmeal,,,,,N', '2 eggs,14,140,56,0,N', '"Tuna, canned",20,,,,Y'])
    expect(io.local.get('suggestions.csv').content).toBe(onedrive.store.get('suggestions.csv').content)
  })
  it('first connect to a stale Google copy keeps newer local data and pushes it', async () => {
    const fresh = log([row('a', 'Beef bake', '12'), row('b', 'Eggs', '14'), row('c', 'Milk', '14')])
    const stale = log([row('a', 'Beef bake', ''), row('b', 'Eggs', '14'), row('g', 'Only on Google', '5')])
    const io = fakeLocal({
      [LOG]: { content: fresh, mtime: 5000 },
      'goals.md': { content: 'goals v2', mtime: 5000 },
    })
    const google = fakeProvider('google-drive', {
      [LOG]: { content: stale, mtime: 100 },
      'goals.md': { content: 'goals v1', mtime: 100 },
    })

    await syncProviderFiles(google, io)

    const expected = ['a:Beef bake:12', 'b:Eggs:14', 'c:Milk:14', 'g:Only on Google:5']
    expect(rowsOf(io.local.get(LOG).content)).toEqual(expected)
    expect(rowsOf(google.store.get(LOG).content)).toEqual(expected)
    expect(io.local.get('goals.md').content).toBe('goals v2')
    expect(google.store.get('goals.md').content).toBe('goals v2')
  })

  it('a reconnected provider whose copy matches its old base is simply brought up to date', async () => {
    const old = log([row('a', 'Beef bake', '')])
    const fresh = log([row('a', 'Beef bake', '12'), row('c', 'Milk', '14')])
    const io = fakeLocal({ [LOG]: { content: fresh, mtime: 1 }, 'goals.md': { content: 'v2', mtime: 1 } })
    io.meta.set(`food-base:google-drive:${LOG}`, old)
    io.meta.set('file-base:google-drive:goals.md', 'v1')
    const google = fakeProvider('google-drive', {
      [LOG]: { content: old, mtime: 9999 },
      'goals.md': { content: 'v1', mtime: 9999 },
    })

    await syncProviderFiles(google, io)

    expect(google.store.get(LOG).content).toBe(fresh)
    expect(google.store.get('goals.md').content).toBe('v2')
    expect(io.local.get('goals.md').content).toBe('v2')
  })

  it('an agent edit on OneDrive reaches Google through the local copy', async () => {
    const start = log([row('a', 'Eggs', '14')])
    const io = fakeLocal({ [LOG]: { content: start, mtime: 1 } })
    const onedrive = fakeProvider('onedrive', { [LOG]: { content: start, mtime: 1 } })
    const google = fakeProvider('google-drive', { [LOG]: { content: start, mtime: 1 } })
    await syncProviderFiles(onedrive, io)
    await syncProviderFiles(google, io)

    onedrive.put(LOG, log([row('a', 'Eggs', '14'), row('m', 'Muse milk', '14')]))
    await syncProviderFiles(onedrive, io)
    await syncProviderFiles(google, io)

    const expected = ['a:Eggs:14', 'm:Muse milk:14']
    expect(rowsOf(io.local.get(LOG).content)).toEqual(expected)
    expect(rowsOf(google.store.get(LOG).content)).toEqual(expected)
  })

  it('agent row on one provider and UI row locally both survive', async () => {
    const start = log([row('a', 'Eggs', '14')])
    const io = fakeLocal({ [LOG]: { content: start, mtime: 1 } })
    const onedrive = fakeProvider('onedrive', { [LOG]: { content: start, mtime: 1 } })
    await syncProviderFiles(onedrive, io)

    onedrive.put(LOG, log([row('a', 'Eggs', '14'), row('m', 'Muse', '7')]))
    io.local.set(LOG, { content: log([row('a', 'Eggs', '14'), row('u', 'UI', '3')]), mtime: 2 })
    await syncProviderFiles(onedrive, io)

    const expected = ['a:Eggs:14', 'm:Muse:7', 'u:UI:3']
    expect(rowsOf(io.local.get(LOG).content)).toEqual(expected)
    expect(rowsOf(onedrive.store.get(LOG).content)).toEqual(expected)
  })

  it('creates files the provider is missing and skips unchanged files on later syncs', async () => {
    const io = fakeLocal({ [LOG]: { content: log([row('a', 'Eggs', '14')]), mtime: 1 }, 'goals.md': { content: 'g', mtime: 1 } })
    const google = fakeProvider('google-drive')
    await syncProviderFiles(google, io)
    expect(google.store.get('goals.md').content).toBe('g')
    expect(rowsOf(google.store.get(LOG).content)).toEqual(['a:Eggs:14'])

    await syncProviderFiles(google, io) // learns the post-write revisions
    const before = { ...google.calls }
    await syncProviderFiles(google, io)
    expect(google.calls).toEqual(before)
  })

  it('propagates a local delete of a whole file', async () => {
    const io = fakeLocal({ 'recipes.md': { content: 'r', mtime: 1 } })
    const google = fakeProvider('google-drive', { 'recipes.md': { content: 'r', mtime: 1 } })
    await syncProviderFiles(google, io)
    io.local.set('recipes.md', { content: null, mtime: 2 })
    await syncProviderFiles(google, io)
    expect(google.store.has('recipes.md')).toBe(false)
  })

  it('does not overwrite a local edit made during the sync', async () => {
    const io = fakeLocal({ 'goals.md': { content: 'v1', mtime: 1 } })
    const google = fakeProvider('google-drive', { 'goals.md': { content: 'v1', mtime: 1 } })
    await syncProviderFiles(google, io)
    google.put('goals.md', 'remote v2')
    const read = google.readRemote
    google.readRemote = async (...a) => {
      const r = await read(...a)
      io.local.set('goals.md', { content: 'typed meanwhile', mtime: Date.now() })
      return r
    }
    await syncProviderFiles(google, io)
    expect(io.local.get('goals.md').content).toBe('typed meanwhile')
    google.readRemote = read
    await syncProviderFiles(google, io)
    // Both changed since base: newest wins (the local edit).
    expect(google.store.get('goals.md').content).toBe('typed meanwhile')
  })

  it('upgrade: a pending local delete with no base wins over an older remote copy', async () => {
    const io = fakeLocal({ 'recipes.md': { content: null, mtime: 5000 } })
    const google = fakeProvider('google-drive', { 'recipes.md': { content: 'old recipes', mtime: 100 } })
    await syncProviderFiles(google, io)
    expect(google.store.has('recipes.md')).toBe(false)
  })

  it('a file merely absent locally is pulled on first connect', async () => {
    const io = fakeLocal()
    const google = fakeProvider('google-drive', { 'recipes.md': { content: 'r', mtime: 100 } })
    await syncProviderFiles(google, io)
    expect(io.local.get('recipes.md').content).toBe('r')
  })

  it('retries a versioned write that lost a race instead of overwriting', async () => {
    const start = log([row('a', 'Eggs', '14')])
    const io = fakeLocal({ [LOG]: { content: start, mtime: 1 } })
    const google = fakeProvider('google-drive', { [LOG]: { content: start, mtime: 1 } })
    await syncProviderFiles(google, io)
    io.local.set(LOG, { content: log([row('a', 'Eggs', '14'), row('u', 'UI', '3')]), mtime: 2 })
    const readV = google.readVersioned
    let raced = false
    google.readVersioned = async name => {
      const snap = await readV(name)
      if (!raced) { raced = true; google.put(LOG, log([row('a', 'Eggs', '14'), row('x', 'Other device', '9')])) }
      return snap
    }
    await syncProviderFiles(google, io)
    const expected = ['a:Eggs:14', 'u:UI:3', 'x:Other device:9']
    expect(rowsOf(google.store.get(LOG).content)).toEqual(expected)
    expect(rowsOf(io.local.get(LOG).content)).toEqual(expected)
  })
})
