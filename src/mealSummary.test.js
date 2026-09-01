import { describe, it, expect, vi } from 'vitest'
import {
  MEAL_ORDER,
  UNGROUPED_MEAL,
  mealTotals,
  groupByMeal,
  formatMealSummary,
  mealToText,
  dayToText,
  copyText,
} from './mealSummary.js'

const entry = (over = {}) => ({
  Date: '2026-06-22',
  Meal: 'Lunch',
  'Food Description': 'Chicken salad',
  Calories: 400,
  'Protein (g)': 30,
  'Calcium (mg)': 100,
  'Veg Servings': 1,
  'Water (oz)': 0,
  'Omega-3': '',
  ...over,
})

describe('mealTotals', () => {
  it('sums the nutrition columns', () => {
    const t = mealTotals([entry(), entry({ Calories: 100, 'Protein (g)': 5, 'Calcium (mg)': 20, 'Veg Servings': 0.5 })])
    expect(t.cal).toBe(500)
    expect(t.pro).toBe(35)
    expect(t.ca).toBe(120)
    expect(t.veg).toBe(1.5)
    expect(t.count).toBe(2)
  })

  it('treats blank and non-numeric cells as zero rather than NaN', () => {
    const t = mealTotals([entry({ Calories: '', 'Protein (g)': undefined, 'Calcium (mg)': 'n/a', 'Veg Servings': null })])
    expect(t.cal).toBe(0)
    expect(t.pro).toBe(0)
    expect(t.ca).toBe(0)
    expect(t.veg).toBe(0)
    expect(t.count).toBe(1)
  })

  it('flags omega-3 when any entry carries it', () => {
    expect(mealTotals([entry(), entry({ 'Omega-3': 'Y' })]).omega3).toBe(true)
    expect(mealTotals([entry()]).omega3).toBe(false)
  })

  it('rounds water and veg to the half so floats do not leak into the UI', () => {
    const t = mealTotals([entry({ 'Water (oz)': 0.1, 'Veg Servings': 0.2 }), entry({ 'Water (oz)': 0.2, 'Veg Servings': 0.2 })])
    expect(t.water).toBe(0.5)
    expect(t.veg).toBe(0.5)
  })

  it('returns zeroes for no entries', () => {
    expect(mealTotals([]).count).toBe(0)
    expect(mealTotals().cal).toBe(0)
  })
})

describe('groupByMeal', () => {
  it('orders meals by the menu, not by insertion order', () => {
    const groups = groupByMeal([
      entry({ Meal: 'Dinner' }),
      entry({ Meal: 'Breakfast' }),
      entry({ Meal: 'Snack' }),
      entry({ Meal: 'Lunch' }),
    ])
    expect(groups.map(g => g.meal)).toEqual(MEAL_ORDER)
  })

  it('omits meals with no entries', () => {
    const groups = groupByMeal([entry({ Meal: 'Breakfast' })])
    expect(groups.map(g => g.meal)).toEqual(['Breakfast'])
  })

  it('keeps blank and unrecognised meals instead of dropping the food', () => {
    const groups = groupByMeal([
      entry({ Meal: '' }),
      entry({ Meal: 'Brunch' }),
      entry({ Meal: 'Lunch' }),
    ])
    expect(groups.map(g => g.meal)).toEqual(['Lunch', UNGROUPED_MEAL])
    expect(groups.find(g => g.meal === UNGROUPED_MEAL).entries).toHaveLength(2)
  })

  it('never loses an entry', () => {
    const entries = [
      entry({ Meal: 'Dinner' }),
      entry({ Meal: '' }),
      entry({ Meal: 'Breakfast' }),
      entry({ Meal: 'Breakfast' }),
    ]
    const grouped = groupByMeal(entries).flatMap(g => g.entries)
    expect(grouped).toHaveLength(entries.length)
    for (const e of entries) expect(grouped).toContain(e)
  })

  it('tolerates surrounding whitespace on the meal name', () => {
    expect(groupByMeal([entry({ Meal: '  Dinner ' })]).map(g => g.meal)).toEqual(['Dinner'])
  })

  it('attaches totals to each group', () => {
    const groups = groupByMeal([entry({ Meal: 'Lunch' }), entry({ Meal: 'Lunch', Calories: 100 })])
    expect(groups[0].totals.cal).toBe(500)
    expect(groups[0].totals.count).toBe(2)
  })

  it('returns nothing for an empty day', () => {
    expect(groupByMeal([])).toEqual([])
    expect(groupByMeal()).toEqual([])
  })
})

describe('formatMealSummary', () => {
  it('always leads with the item count, correctly pluralised', () => {
    expect(formatMealSummary(mealTotals([entry()]))).toMatch(/^1 item /)
    expect(formatMealSummary(mealTotals([entry(), entry()]))).toMatch(/^2 items /)
  })

  it('omits zero-valued nutrients so a quick-add is not a row of zeroes', () => {
    const summary = formatMealSummary(mealTotals([
      entry({ Calories: '', 'Protein (g)': '', 'Calcium (mg)': '', 'Veg Servings': '' }),
    ]))
    expect(summary).toBe('1 item')
    expect(summary).not.toMatch(/0 kcal/)
  })

  it('includes water and omega-3 only when present', () => {
    expect(formatMealSummary(mealTotals([entry()]))).not.toMatch(/water|ω-3/)
    const rich = formatMealSummary(mealTotals([entry({ 'Water (oz)': 8, 'Omega-3': 'Y' })]))
    expect(rich).toMatch(/8oz water/)
    expect(rich).toMatch(/ω-3/)
  })

  it('does not throw on missing totals', () => {
    expect(formatMealSummary()).toBe('0 items')
  })
})

describe('mealToText', () => {
  it('writes a header, one line per food and a total', () => {
    const group = groupByMeal([entry(), entry({ 'Food Description': 'Apple', Calories: 95, 'Protein (g)': 0 })])[0]
    const text = mealToText(group, '2026-06-22')
    expect(text.split('\n')[0]).toBe('Lunch — 2026-06-22')
    expect(text).toContain('- Chicken salad — 400 kcal, 30g protein')
    expect(text).toContain('- Apple — 95 kcal')
    expect(text).toMatch(/^Total: 2 items · 495 kcal/m)
  })

  it('is plain text — no markdown table pipes and no emoji', () => {
    const text = mealToText(groupByMeal([entry()])[0], '2026-06-22')
    expect(text).not.toContain('|')
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })

  it('omits the date from the header when none is given', () => {
    expect(mealToText(groupByMeal([entry()])[0], null).split('\n')[0]).toBe('Lunch')
  })

  it('still names an entry that has no description', () => {
    const text = mealToText(groupByMeal([entry({ 'Food Description': '  ' })])[0])
    expect(text).toContain('- (no description)')
  })

  it('drops the nutrition suffix for an entry with none', () => {
    const text = mealToText(groupByMeal([entry({ Calories: '', 'Protein (g)': '' })])[0])
    expect(text).toContain('- Chicken salad\n')
  })

  it('returns an empty string for no group', () => {
    expect(mealToText(null, '2026-06-22')).toBe('')
  })
})

describe('dayToText', () => {
  it('renders meals in menu order with a day total', () => {
    const text = dayToText([
      entry({ Meal: 'Dinner', 'Food Description': 'Curry' }),
      entry({ Meal: 'Breakfast', 'Food Description': 'Oats' }),
    ], '2026-06-22')
    expect(text.indexOf('Breakfast')).toBeLessThan(text.indexOf('Dinner'))
    expect(text.split('\n')[0]).toBe('2026-06-22')
    expect(text).toMatch(/Day total: 2 items · 800 kcal/)
  })

  it('says so rather than producing a bare date for an empty day', () => {
    expect(dayToText([], '2026-06-22')).toBe('2026-06-22\n(no entries)')
    expect(dayToText([])).toBe('(no entries)')
  })

  it('agrees with the on-screen summary for the same entries', () => {
    const entries = [entry(), entry({ Meal: 'Dinner', Calories: 600, 'Protein (g)': 40 })]
    expect(dayToText(entries, '2026-06-22')).toContain(`Day total: ${formatMealSummary(mealTotals(entries))}`)
  })
})

describe('copyText', () => {
  it('uses the async clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    await expect(copyText('hello', { clipboard: { writeText } })).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('reports failure instead of throwing when the clipboard rejects', async () => {
    const nav = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } }
    await expect(copyText('hello', nav)).resolves.toBe(false)
  })

  it('reports failure when there is no clipboard at all', async () => {
    await expect(copyText('hello', {})).resolves.toBe(false)
  })

  it('refuses to copy nothing', async () => {
    const writeText = vi.fn()
    await expect(copyText('', { clipboard: { writeText } })).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})
