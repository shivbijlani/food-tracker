import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as debugLog from './llmDebugLog.js'

// Vitest runs in the node environment here, so provide a minimal localStorage.
function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

beforeEach(() => {
  globalThis.localStorage = makeStorage()
})

afterEach(() => {
  delete globalThis.localStorage
  vi.restoreAllMocks()
})

describe('llmDebugLog — enable/disable', () => {
  it('is off by default and records nothing', () => {
    expect(debugLog.isEnabled()).toBe(false)
    debugLog.record({ feature: 'coach', responseText: 'hi' })
    expect(debugLog.getLogs()).toEqual([])
  })

  it('records once enabled', () => {
    debugLog.setEnabled(true)
    expect(debugLog.isEnabled()).toBe(true)
    debugLog.record({ feature: 'coach', provider: 'github', model: 'gpt-4o-mini', responseText: 'hi' })
    const logs = debugLog.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ feature: 'coach', provider: 'github', model: 'gpt-4o-mini', outcome: 'ok' })
    expect(logs[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('stops recording again when switched off', () => {
    debugLog.setEnabled(true)
    debugLog.record({ feature: 'coach' })
    debugLog.setEnabled(false)
    debugLog.record({ feature: 'coach' })
    expect(debugLog.getLogs()).toHaveLength(1)
  })
})

describe('llmDebugLog — ring buffer', () => {
  it('keeps only the most recent MAX_RECORDS, dropping oldest first', () => {
    debugLog.setEnabled(true)
    for (let i = 0; i < debugLog.MAX_RECORDS + 5; i++) {
      debugLog.record({ feature: 'estimate', responseText: `r${i}` })
    }
    const logs = debugLog.getLogs()
    expect(logs).toHaveLength(debugLog.MAX_RECORDS)
    // Oldest five are gone; newest is the last written.
    expect(logs[0].responseText).toBe('r5')
    expect(logs[logs.length - 1].responseText).toBe(`r${debugLog.MAX_RECORDS + 4}`)
  })

  it('clearLogs empties the buffer', () => {
    debugLog.setEnabled(true)
    debugLog.record({ feature: 'coach' })
    expect(debugLog.getLogs()).toHaveLength(1)
    debugLog.clearLogs()
    expect(debugLog.getLogs()).toEqual([])
  })

  it('treats a corrupt buffer as empty rather than throwing', () => {
    debugLog.setEnabled(true)
    globalThis.localStorage.setItem('mealjot-llm-debug-log', '{not json')
    expect(debugLog.getLogs()).toEqual([])
  })
})

describe('llmDebugLog — redaction', () => {
  it('scrubs key-shaped tokens', () => {
    expect(debugLog.redact('key sk-abcdefghijklmnopqrstuvwx here')).toContain('[REDACTED]')
    expect(debugLog.redact('key sk-ant-abcdefghijkl here')).toContain('[REDACTED]')
    expect(debugLog.redact('ghp_abcdefghijklmnop')).toContain('[REDACTED]')
    expect(debugLog.redact('github_pat_abcdefghijk')).toContain('[REDACTED]')
    expect(debugLog.redact('Authorization: Bearer abcdefghijklmnop')).toContain('[REDACTED]')
  })

  it('leaves ordinary text alone', () => {
    const text = 'You still need 109g protein today.'
    expect(debugLog.redact(text)).toBe(text)
  })

  it('redacts secrets that reach the buffer through a record', () => {
    debugLog.setEnabled(true)
    debugLog.record({ feature: 'estimate', userPrompt: 'token sk-abcdefghijklmnopqrstuvwx' })
    const [entry] = debugLog.getLogs()
    expect(entry.userPrompt).not.toContain('sk-abcdefghijklmnopqrstuvwx')
    expect(entry.userPrompt).toContain('[REDACTED]')
  })

  it('truncates very long fields', () => {
    debugLog.setEnabled(true)
    debugLog.record({ feature: 'estimate', userPrompt: 'x'.repeat(9000) })
    const [entry] = debugLog.getLogs()
    expect(entry.userPrompt.length).toBeLessThan(9000)
    expect(entry.userPrompt).toContain('truncated')
  })
})

describe('llmDebugLog — resilience', () => {
  it('never throws when storage writes fail', () => {
    debugLog.setEnabled(true)
    globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError') }
    expect(() => debugLog.record({ feature: 'coach' })).not.toThrow()
  })

  it('never throws when localStorage is absent entirely', () => {
    delete globalThis.localStorage
    expect(debugLog.isEnabled()).toBe(false)
    expect(() => debugLog.record({ feature: 'coach' })).not.toThrow()
    expect(debugLog.getLogs()).toEqual([])
  })
})

describe('llmDebugLog — markdown export', () => {
  it('reports an empty buffer', () => {
    expect(debugLog.toMarkdown([])).toMatch(/No LLM diagnostic logs/)
  })

  it('produces a self-describing, pasteable report', () => {
    debugLog.setEnabled(true)
    debugLog.record({
      feature: 'coach',
      provider: 'openrouter',
      model: 'meta-llama/llama-3.3-8b-instruct:free',
      systemPrompt: 'Reply with the coaching message only',
      userPrompt: 'Daily protein goal: 120g',
      responseText: 'We need to respond with 2-3 plain text sentences',
      outcome: 'leak-filtered',
      status: 200,
      latencyMs: 812,
    })
    const md = debugLog.toMarkdown()
    expect(md).toContain('Mealjot LLM diagnostics')
    expect(md).toContain('meta-llama/llama-3.3-8b-instruct:free')
    expect(md).toContain('openrouter')
    expect(md).toContain('leak-filtered')
    expect(md).toContain('1 not ok')
    expect(md).toContain('We need to respond with 2-3 plain text sentences')
  })
})
