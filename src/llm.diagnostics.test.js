import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as debugLog from './llmDebugLog.js'
import { getCoaching, estimateNutrition } from './llm.js'

// Proves the wiring in llm.js, not just the buffer module: a call must land
// exactly one record, with the outcome that matches what the user saw.

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

/** A coaching reply that the leak filter is expected to reject. */
const LEAKED = 'We need to respond with 2-3 plain text sentences, maximum 60 words. Plain text only.'

beforeEach(() => {
  globalThis.localStorage = makeStorage({
    'mealjot-llm-provider': 'github',
    'mealjot-github-key': 'ghp_testtesttesttest',
    'mealjot-github-model': 'openai/gpt-4o-mini',
  })
  debugLog.setEnabled(true)
})

afterEach(() => {
  delete globalThis.localStorage
  vi.restoreAllMocks()
})

describe('getCoaching diagnostics', () => {
  it('records a leak-filtered response even though the user sees nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: LEAKED } }] })))

    const result = await getCoaching({ proteinGoal: 120 })

    // Behaviour is unchanged: the leak is still suppressed in the UI.
    expect(result).toBeNull()

    const logs = debugLog.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ feature: 'coach', outcome: 'leak-filtered', status: 200 })
    expect(logs[0].responseText).toContain('2-3 plain text sentences')
    expect(logs[0].model).toBe('openai/gpt-4o-mini')
    expect(typeof logs[0].latencyMs).toBe('number')
  })

  it('records a good coaching reply as ok and still returns it', async () => {
    const good = 'You have 109g of protein left today; a shake and eggs would close most of it.'
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: good } }] })))

    const result = await getCoaching({ proteinGoal: 120 })

    expect(result).toBe(good)
    const logs = debugLog.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].outcome).toBe('ok')
  })

  it('records an HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: 'rate limited' }, { ok: false, status: 429 })))

    expect(await getCoaching({ proteinGoal: 120 })).toBeNull()
    const logs = debugLog.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ outcome: 'http-error', status: 429 })
  })

  it('records nothing at all when diagnostics are off', async () => {
    debugLog.setEnabled(false)
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: LEAKED } }] })))

    await getCoaching({ proteinGoal: 120 })
    expect(debugLog.getLogs()).toEqual([])
  })
})

describe('estimateNutrition diagnostics', () => {
  it('records a successful estimate with the parsed result', async () => {
    const payload = { calories: 210, protein_g: 11, calcium_mg: 60, veg_servings: 0, omega3: 'N', confidence: 'medium' }
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: JSON.stringify(payload) } }] })))

    const result = await estimateNutrition('3oz pork taco')

    expect(result.protein_g).toBe(11)
    const logs = debugLog.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ feature: 'estimate', outcome: 'ok', status: 200 })
    expect(logs[0].userPrompt).toBe('3oz pork taco')
  })

  it('records an API error and still rethrows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: 'boom' }, { ok: false, status: 500 })))

    await expect(estimateNutrition('3oz pork taco')).rejects.toThrow(/500/)

    const logs = debugLog.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ feature: 'estimate', outcome: 'error', status: 500 })
  })
})
