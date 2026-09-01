import { describe, it, expect } from 'vitest'
import {
  todayStr, isValidDateStr, shiftDate, daysBetween,
  formatDateLabel, canGoNext, entriesForDate, clampDate,
} from './dateNav.js'

// Issue #57: "When I select a different date on the tracker, it should show the
// bars and already-tracked food for that day. I should also be able to track
// food for that day even if it's in the past."
//
// The bug class these guard against is timezone drift. The app's users are in
// Seattle (UTC-7/-8), so any implementation that routes a YYYY-MM-DD string
// through `new Date(str)` lands on the previous day. That would silently log
// food to the wrong date, which is worse than not having the feature.

describe('todayStr', () => {
  it('formats the local date, not the UTC date', () => {
    // 2026-09-01 17:30 local. If this went through toISOString() in a
    // negative-offset zone it would come back as 2026-09-02.
    const d = new Date(2026, 8, 1, 17, 30, 0)
    expect(todayStr(d)).toBe('2026-09-01')
  })

  it('zero-pads single-digit months and days', () => {
    expect(todayStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('isValidDateStr', () => {
  it('accepts a well-formed date', () => {
    expect(isValidDateStr('2026-09-01')).toBe(true)
  })

  it.each(['', null, undefined, '2026-9-1', '20260901', 'today', '2026-13-01', '2026-02-30', '2026-00-10'])(
    'rejects %p', (bad) => {
      expect(isValidDateStr(bad)).toBe(false)
    })

  it('knows February in a leap year', () => {
    expect(isValidDateStr('2028-02-29')).toBe(true)
    expect(isValidDateStr('2026-02-29')).toBe(false)
  })
})

describe('shiftDate', () => {
  it('steps back and forward a day', () => {
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftDate('2026-09-01', 1)).toBe('2026-09-02')
  })

  it('crosses a month boundary', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('crosses a year boundary', () => {
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2025-12-31', 1)).toBe('2026-01-01')
  })

  it('handles a leap day', () => {
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29')
    expect(shiftDate('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('does not drift across a DST transition', () => {
    // US DST ends 2026-11-01. A local-time implementation adding 86400000 ms
    // lands on 2026-11-01T23:00 and still formats as 11-01, losing a day.
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01')
    // And the spring-forward side.
    expect(shiftDate('2026-03-08', -1)).toBe('2026-03-07')
    expect(shiftDate('2026-03-07', 1)).toBe('2026-03-08')
  })

  it('leaves a malformed date alone rather than navigating somewhere arbitrary', () => {
    expect(shiftDate('nonsense', -1)).toBe('nonsense')
  })

  it('round-trips over a long span', () => {
    let d = '2026-09-01'
    for (let i = 0; i < 400; i++) d = shiftDate(d, -1)
    for (let i = 0; i < 400; i++) d = shiftDate(d, 1)
    expect(d).toBe('2026-09-01')
  })
})

describe('daysBetween', () => {
  it('is signed: negative when the second date is earlier', () => {
    expect(daysBetween('2026-09-01', '2026-08-31')).toBe(-1)
    expect(daysBetween('2026-09-01', '2026-09-02')).toBe(1)
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(0)
  })

  it('counts across a DST boundary as whole days', () => {
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
  })

  it('returns 0 for malformed input instead of NaN', () => {
    expect(daysBetween('nope', '2026-09-01')).toBe(0)
  })
})

describe('formatDateLabel', () => {
  const today = '2026-09-01'

  it('names the relative days rather than dating them', () => {
    expect(formatDateLabel('2026-09-01', today)).toBe('Today')
    expect(formatDateLabel('2026-08-31', today)).toBe('Yesterday')
    expect(formatDateLabel('2026-09-02', today)).toBe('Tomorrow')
  })

  it('uses a short weekday + date further back', () => {
    // 2026-08-28 is a Friday.
    expect(formatDateLabel('2026-08-28', today)).toBe('Fri, Aug 28')
  })

  it('adds the year only when it is not the current one', () => {
    expect(formatDateLabel('2025-12-25', today)).toBe('Thu, Dec 25, 2025')
    expect(formatDateLabel('2026-01-01', today)).toBe('Thu, Jan 1')
  })

  it('does not shift the weekday by a day in a negative-offset timezone', () => {
    // The whole point: 2026-09-01 is a Tuesday. A UTC-parsed local render
    // would say Monday.
    expect(formatDateLabel('2026-08-25', today)).toBe('Tue, Aug 25')
  })
})

describe('canGoNext', () => {
  const today = '2026-09-01'

  it('allows moving forward while in the past', () => {
    expect(canGoNext('2026-08-30', today)).toBe(true)
    expect(canGoNext('2026-08-31', today)).toBe(true)
  })

  it('stops at today', () => {
    expect(canGoNext(today, today)).toBe(false)
  })

  it('stays stopped if somehow already ahead of today', () => {
    expect(canGoNext('2026-09-05', today)).toBe(false)
  })
})

describe('entriesForDate', () => {
  const entries = [
    { Date: '2026-08-31', Food: 'oatmeal' },
    { Date: '2026-09-01', Food: 'apple' },
    { Date: '2026-08-31', Food: 'salmon' },
  ]

  it('selects only the requested day', () => {
    expect(entriesForDate(entries, '2026-08-31').map(e => e.Food)).toEqual(['oatmeal', 'salmon'])
  })

  it('preserves original order so index-based edit and delete stay aligned', () => {
    const day = entriesForDate(entries, '2026-08-31')
    expect(entries.indexOf(day[0])).toBe(0)
    expect(entries.indexOf(day[1])).toBe(2)
  })

  it('returns empty for a day with nothing logged', () => {
    expect(entriesForDate(entries, '2026-07-04')).toEqual([])
  })

  it('tolerates missing or ragged input', () => {
    expect(entriesForDate(undefined, '2026-09-01')).toEqual([])
    expect(entriesForDate([null, { Date: '2026-09-01' }], '2026-09-01')).toHaveLength(1)
  })
})

describe('clampDate', () => {
  const today = '2026-09-01'

  it('passes a past date through untouched', () => {
    expect(clampDate('2026-08-01', today)).toBe('2026-08-01')
    expect(clampDate(today, today)).toBe(today)
  })

  it('pulls a typed future date back to today', () => {
    expect(clampDate('2027-01-01', today)).toBe(today)
  })

  it('falls back to today when the picker is cleared', () => {
    // Native date inputs report '' when emptied; without this the view would
    // filter on '' and show an empty day with no way back.
    expect(clampDate('', today)).toBe(today)
    expect(clampDate('garbage', today)).toBe(today)
  })
})
