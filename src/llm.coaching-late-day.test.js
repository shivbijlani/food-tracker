// Late-day "untracked, not uneaten" guard — issue #54.
//
// The behaviour under test is a hard rule in code rather than prompt guidance,
// so these tests assert the thing that makes it a hard rule: when the guard
// fires, the model is never consulted at all.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isLateDayUntracked,
  getCoaching,
  LATE_DAY_HOUR,
  UNTRACKED_LATE_DAY_MESSAGE,
} from './llm.js'

describe('isLateDayUntracked', () => {
  it('fires late in the day with nothing logged', () => {
    expect(isLateDayUntracked({ currentHour: 23, todayEntryCount: 0 })).toBe(true)
  })

  it('does not fire earlier in the day, when an empty log is normal', () => {
    // 9 AM with nothing logged is just "breakfast hasn't happened yet".
    expect(isLateDayUntracked({ currentHour: 9, todayEntryCount: 0 })).toBe(false)
  })

  it('does not fire once anything at all has been logged', () => {
    // The user IS tracking — telling them "nothing logged" would be wrong.
    expect(isLateDayUntracked({ currentHour: 23, todayEntryCount: 1 })).toBe(false)
  })

  it('treats the cutoff hour as inclusive and the hour before it as exempt', () => {
    expect(isLateDayUntracked({ currentHour: LATE_DAY_HOUR, todayEntryCount: 0 })).toBe(true)
    expect(isLateDayUntracked({ currentHour: LATE_DAY_HOUR - 1, todayEntryCount: 0 })).toBe(false)
  })

  it('does not fire when reviewing a past date, which has no meaningful "now"', () => {
    // useCoaching leaves currentHour null for any day that is not today.
    expect(isLateDayUntracked({ currentHour: null, todayEntryCount: 0 })).toBe(false)
    expect(isLateDayUntracked({ todayEntryCount: 0 })).toBe(false)
  })

  it('does not fire in the moment right after a meal is saved', () => {
    // The entry may not have propagated into todayEntryCount yet; the user
    // has demonstrably just tracked something.
    expect(isLateDayUntracked({
      currentHour: 23, todayEntryCount: 0, justLoggedMeal: true,
    })).toBe(false)
  })

  it('survives being called with no arguments', () => {
    expect(isLateDayUntracked()).toBe(false)
  })
})

describe('getCoaching late-day short-circuit', () => {
  let store

  beforeEach(() => {
    store = { 'mealjot-llm-provider': 'openai', 'mealjot-openai-key': 'sk-test' }
    vi.stubGlobal('localStorage', {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: k => { delete store[k] },
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the track-it message without ever calling the model', async () => {
    const text = await getCoaching({
      currentHour: 23,
      todayEntryCount: 0,
      proteinGoal: 120,
    })
    expect(text).toBe(UNTRACKED_LATE_DAY_MESSAGE)
    // The whole point of the guard: no model call, so no chance of the
    // "eat 120g before bed" reply that issue #54 reports.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never tells the user to eat to close the full gap', async () => {
    const text = await getCoaching({ currentHour: 23, todayEntryCount: 0, proteinGoal: 120 })
    expect(text).not.toMatch(/\b120\s*g\b/i)
    expect(text.toLowerCase()).toContain('logged')
  })

  it('still consults the model when something has been logged', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Nice work today.' } }] }),
    })
    const text = await getCoaching({ currentHour: 23, todayEntryCount: 2, proteinGoal: 120 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(text).toBe('Nice work today.')
  })

  it('still consults the model earlier in the day with an empty log', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Good morning.' } }] }),
    })
    const text = await getCoaching({ currentHour: 8, todayEntryCount: 0, proteinGoal: 120 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(text).toBe('Good morning.')
  })

  it('shows no card at all when no API key is configured', async () => {
    // Behaviour-preserving: the guard sits after the key check, so an app with
    // no LLM configured does not suddenly gain a coaching card.
    delete store['mealjot-openai-key']
    const text = await getCoaching({ currentHour: 23, todayEntryCount: 0 })
    expect(text).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
