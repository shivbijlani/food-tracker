import { writeEntries } from '../src/mdyaml.js'
import { DAILY_LOG_HEADERS, PROTEIN_LOG_HEADERS } from '../src/markdown.js'
import { ToolError } from '../src/tools.js'

export const FOODS = 'name,protein_g,calories,calcium_mg,veg_servings,omega3\nGreek yogurt,20,120,200,,N\nApple,,80,,,\n'
export const RECIPES = '| Recipe | Servings | Calories | Protein (g) | Calcium (mg) | Notes |\n|---|---|---|---|---|---|\n| Chili | 4 | 800 | 100 | 40 | |\n'
export const CONCURRENT = { Date: '2026-10-12', Meal: 'Lunch', 'Food Description': 'Concurrent food', 'Protein (g)': '7', Id: 'concurrent-id' }

export class MemoryStore {
  constructor() {
    this.files = new Map([['suggestions.csv', FOODS], ['recipes.md', RECIPES]])
    this.version = 0
    this.writes = 0
  }
  async read(name) { return { content: this.files.get(name) ?? null, etag: this.version, id: this.files.has(name) ? name : null } }
  async write(name, content, snapshot) {
    this.writes++
    if (this.beforeWrite) { const fn = this.beforeWrite; this.beforeWrite = null; fn(name); this.version++ }
    if (snapshot.etag !== this.version) throw new ToolError('PRECONDITION_FAILED', 'changed')
    this.files.set(name, content)
    this.version++
  }
}

export function mockGraph({ forceConflict = false } = {}) {
  const files = new Map([['suggestions.csv', FOODS], ['recipes.md', RECIPES]])
  const versions = new Map([...files.keys()].map(name => [name, 1]))
  const requests = []
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body })
    const response = (value, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status })
    if (url.startsWith('https://download.test/')) {
      if (init.headers?.Authorization) throw new Error('Authorization leaked to download host')
      return response(files.get(decodeURIComponent(url.split('/').pop())))
    }
    if (!init.headers?.Authorization) return response({}, 401)
    if (url.includes('/children') && !init.method) {
      return response({ value: [...files.keys()].map(name => ({ name, file: {}, lastModifiedDateTime: new Date().toISOString() })) })
    }
    if (init.method === 'POST') {
      const { name } = JSON.parse(init.body)
      if (files.has(name)) return response({}, 409)
      files.set(name, '')
      versions.set(name, 1)
      return response({ id: name, eTag: '1' }, 201)
    }
    if (init.method === 'PUT') {
      const name = url.includes('/items/') ? decodeURIComponent(url.split('/').at(-2)) :
        decodeURIComponent(url.split('approot:/')[1].split(':/content')[0])
      if (forceConflict) {
        forceConflict = false
        const simple = name.startsWith('protein-')
        files.set(name, writeEntries('', simple ? PROTEIN_LOG_HEADERS : DAILY_LOG_HEADERS,
          [{ ...CONCURRENT, Meal: simple ? 'Concurrent food' : CONCURRENT.Meal }],
          { kind: 'entries', mode: simple ? 'simple' : 'advanced' }))
        versions.set(name, (versions.get(name) || 0) + 1)
        return response({}, 412)
      }
      if (init.headers['If-None-Match'] === '*') {
        if (files.has(name)) return response({}, 412)
      } else if (init.headers['If-Match'] !== String(versions.get(name))) return response({}, 412)
      files.set(name, init.body)
      versions.set(name, (versions.get(name) || 0) + 1)
      return response({ id: name, eTag: String(versions.get(name)) })
    }
    const name = decodeURIComponent(url.split('approot:/')[1]?.split('?')[0] || '')
    if (!files.has(name)) return response({}, 404)
    return response({ id: name, eTag: String(versions.get(name)), '@microsoft.graph.downloadUrl': `https://download.test/${encodeURIComponent(name)}` })
  }
  return { fetchImpl, files, requests }
}
