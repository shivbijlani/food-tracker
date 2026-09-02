import { describe, it, expect } from 'vitest'
import {
  todayStr,
  isValidDateStr,
  shiftDate,
  formatDayLabel,
  dayHeading,
  dayPhrase,
  canGoForward,
  clampToToday,
} from './dateNav.js'

// Coverage for issue #57: the tracker must be able to show and log to a day
// other than today. Everything here is pure string arithmetic, deliberately, so
// the day the view lands on cannot depend on the machine's timezone.

describe('todayStr', () => {
  it('formats a date as YYYY-MM-DD with zero padding', () => {
    expect(todayStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('matches the shape the entry rows are stored with', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('isValidDateStr', () => {
  it('accepts a well-formed date', () => {
    expect(isValidDateStr('2026-09-02')).toBe(true)
  })

  it('rejects a day that does not exist in that month', () => {
    expect(isValidDateStr('2026-02-30')).toBe(false)
  })

  it('accepts a real leap day and rejects a fake one', () => {
    expect(isValidDateStr('2024-02-29')).toBe(true)
    expect(isValidDateStr('2026-02-29')).toBe(false)
  })

  it('rejects junk, wrong shapes and non-strings', () => {
    for (const bad of ['', 'today', '2026-9-2', '20260902', null, undefined, 42]) {
      expect(isValidDateStr(bad)).toBe(false)
    }
  })
})

describe('shiftDate', () => {
  it('steps back and forward by a day', () => {
    expect(shiftDate('2026-09-02', -1)).toBe('2026-09-01')
    expect(shiftDate('2026-09-02', 1)).toBe('2026-09-03')
  })

  it('crosses a month boundary', () => {
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftDate('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('crosses a year boundary', () => {
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2025-12-31', 1)).toBe('2026-01-01')
  })

  it('handles leap years in both directions', () => {
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })

  // The reason this module does its arithmetic in UTC. US DST starts
  // 2026-03-08 and ends 2026-11-01; a local-midnight Date plus 86400000 ms can
  // land back on the same calendar day across those boundaries.
  it('steps exactly one calendar day across both DST transitions', () => {
    expect(shiftDate('2026-03-07', 1)).toBe('2026-03-08')
    expect(shiftDate('2026-03-08', 1)).toBe('2026-03-09')
    expect(shiftDate('2026-03-08', -1)).toBe('2026-03-07')
    expect(shiftDate('2026-11-01', 1)).toBe('2026-11-02')
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31')
  })

  it('is reversible over a long span', () => {
    let d = '2026-09-02'
    for (let i = 0; i < 400; i++) d = shiftDate(d, -1)
    for (let i = 0; i < 400; i++) d = shiftDate(d, 1)
    expect(d).toBe('2026-09-02')
  })

  it('returns malformed input unchanged rather than throwing', () => {
    expect(shiftDate('not-a-date', -1)).toBe('not-a-date')
  })
})

describe('formatDayLabel', () => {
  const today = '2026-09-02'

  it('names today and yesterday', () => {
    expect(formatDayLabel('2026-09-02', today)).toBe('Today')
    expect(formatDayLabel('2026-09-01', today)).toBe('Yesterday')
  })

  it('gives weekday and date for anything older', () => {
    expect(formatDayLabel('2026-08-31', today)).toBe('Mon, 31 Aug')
    expect(formatDayLabel('2026-08-30', today)).toBe('Sun, 30 Aug')
  })

  it('does not shift the weekday because of the local timezone', () => {
    // 2026-01-01 is a Thursday in UTC and must read as one everywhere.
    expect(formatDayLabel('2026-01-01', today)).toBe('Thu, 1 Jan')
  })
})

describe('dayHeading', () => {
  const today = '2026-09-02'

  it('is possessive for the named days', () => {
    expect(dayHeading('2026-09-02', today)).toBe("Today's")
    expect(dayHeading('2026-09-01', today)).toBe("Yesterday's")
  })

  it('is not possessive for a dated day', () => {
    expect(dayHeading('2026-08-30', today)).toBe('Sun, 30 Aug')
  })
})

describe('dayPhrase', () => {
  const today = '2026-09-02'

  it('reads naturally inside a sentence', () => {
    // Guards against "Nothing logged on Yesterday", which is what naive
    // interpolation of the display label produces.
    expect(dayPhrase('2026-09-02', today)).toBe('today')
    expect(dayPhrase('2026-09-01', today)).toBe('yesterday')
    expect(dayPhrase('2026-08-30', today)).toBe('on Sun, 30 Aug')
  })
})

describe('canGoForward', () => {
  const today = '2026-09-02'

  it('allows moving forward while in the past', () => {
    expect(canGoForward('2026-09-01', today)).toBe(true)
  })

  it('stops at today, so the view never shows a future day', () => {
    expect(canGoForward('2026-09-02', today)).toBe(false)
    expect(canGoForward('2026-09-03', today)).toBe(false)
  })
})

describe('clampToToday', () => {
  const today = '2026-09-02'

  it('leaves past dates alone', () => {
    expect(clampToToday('2026-08-01', today)).toBe('2026-08-01')
  })

  it('pulls a future date back to today', () => {
    expect(clampToToday('2027-01-01', today)).toBe(today)
  })

  it('falls back to today when the picker is cleared', () => {
    expect(clampToToday('', today)).toBe(today)
  })
})
