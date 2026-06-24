import { describe, it, expect } from 'vitest'
import { buildCoachingUserContent } from './llm.js'

// Regression coverage for the mealjot bug where the morning coach folded the
// previous evening's dinner into "today" — reporting 905 kcal (today's 665 plus
// yesterday's dinner) while the tracker correctly showed 665.

describe('buildCoachingUserContent', () => {
  const ctx = {
    todayEntriesText: 'Breakfast | oatmeal + banana | 20g protein | 665 kcal',
    todayTotals: { calories: 665, protein: 20, calcium: 300, veg: 1, omega3: false },
    recentEntriesText: '2026-06-22 | Dinner | salmon, rice, broccoli | 40g protein',
    currentTime: 'morning',
  }

  it('marks Today\'s totals as the authoritative figure', () => {
    const out = buildCoachingUserContent(ctx)
    expect(out).toMatch(/Today's totals \(authoritative/)
    expect(out).toContain('665kcal')
  })

  it('fences prior-day entries off from today so they are not counted', () => {
    const out = buildCoachingUserContent(ctx)
    // The previous day's dinner must only appear under the "Earlier days"
    // section, never under "Today's meals so far".
    const todayIdx = out.indexOf("Today's meals so far")
    const earlierIdx = out.indexOf('Earlier days')
    const dinnerIdx = out.indexOf('salmon, rice, broccoli')
    expect(earlierIdx).toBeGreaterThan(-1)
    expect(dinnerIdx).toBeGreaterThan(earlierIdx)
    expect(dinnerIdx).toBeGreaterThan(todayIdx)
    expect(out).toMatch(/NOT part of today's intake/)
  })

  it('instructs the model never to add earlier days to today\'s totals', () => {
    const out = buildCoachingUserContent(ctx)
    expect(out).toMatch(/never recompute it or add anything from "Earlier days"/)
  })

  it('omits the Earlier days block entirely when there is no history', () => {
    const out = buildCoachingUserContent({ ...ctx, recentEntriesText: '' })
    expect(out).not.toContain('for spotting habits only')
    expect(out).not.toContain('salmon, rice, broccoli')
  })

  it('handles an empty context without throwing', () => {
    const out = buildCoachingUserContent()
    expect(out).toContain('No meals logged today yet.')
  })
})
