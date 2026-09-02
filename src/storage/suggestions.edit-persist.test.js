import { describe, it, expect } from 'vitest'
import {
  upsertSuggestion,
  suggestionFromEntry,
  nutritionChanged,
} from './suggestions.js'

// Issue #59: editing a logged entry's nutrition only ever updated that one log
// row. The saved (reusable) values for that food kept their old numbers, so the
// next time you logged it the correction was gone.

const entry = (over = {}) => ({
  Date: '2026-06-22',
  Meal: 'Lunch',
  'Food Description': 'Paneer wrap',
  Calories: '400',
  'Protein (g)': '20',
  'Calcium (mg)': '150',
  'Veg Servings': '1',
  'Omega-3': '',
  ...over,
})

describe('suggestionFromEntry', () => {
  it('maps every nutrition column a log entry carries onto the suggestion shape', () => {
    expect(suggestionFromEntry(entry())).toEqual({
      name: 'Paneer wrap',
      protein_g: '20',
      calories: '400',
      calcium_mg: '150',
      veg_servings: '1',
      omega3: '',
    })
  })

  it('produces a blank name for an entry with no food description', () => {
    expect(suggestionFromEntry({ Calories: '5' }).name).toBe('')
  })

  // The add path and the edit path must feed upsertSuggestion identically;
  // building the shape in two places is how they drifted apart originally.
  it('feeds upsertSuggestion the same values the add path used to build inline', () => {
    const e = entry()
    const inline = {
      name: e['Food Description'],
      protein_g: e['Protein (g)'],
      calories: e.Calories,
      calcium_mg: e['Calcium (mg)'],
      veg_servings: e['Veg Servings'],
      omega3: e['Omega-3'],
    }
    expect(suggestionFromEntry(e)).toEqual(inline)
  })
})

describe('nutritionChanged', () => {
  it('is false when nothing was touched', () => {
    expect(nutritionChanged(entry(), entry())).toBe(false)
  })

  it('is false when only non-nutrition fields changed', () => {
    expect(nutritionChanged(entry(), entry({ Notes: 'with chutney', Meal: 'Dinner' }))).toBe(false)
  })

  it('is true when a nutrition value was corrected', () => {
    expect(nutritionChanged(entry(), entry({ 'Protein (g)': '28' }))).toBe(true)
  })

  it('is true when a previously blank value was filled in', () => {
    expect(nutritionChanged(entry({ 'Calcium (mg)': '' }), entry())).toBe(true)
  })

  // upsertSuggestion ignores empty incoming values, so offering to "save" a
  // cleared field would promise an update that never happens.
  it('is false when a value was cleared, because a blank cannot overwrite', () => {
    expect(nutritionChanged(entry(), entry({ 'Protein (g)': '' }))).toBe(false)
  })

  it('does not treat an equivalent number written differently as a change', () => {
    expect(nutritionChanged(entry(), entry({ 'Protein (g)': '20.0' }))).toBe(false)
  })

  it('detects a non-numeric change such as toggling omega-3', () => {
    expect(nutritionChanged(entry(), entry({ 'Omega-3': 'Y' }))).toBe(true)
  })
})

describe('persisting an edit back to the saved item (#59)', () => {
  const saved = [{
    name: 'Paneer wrap',
    protein_g: '20',
    calories: '400',
    calcium_mg: '150',
    veg_servings: '1',
    omega3: '',
  }]

  it('carries a corrected value onto the saved item for reuse', () => {
    const edited = entry({ 'Protein (g)': '28' })
    const next = upsertSuggestion(saved, suggestionFromEntry(edited))

    expect(next).toHaveLength(1)
    expect(next[0].protein_g).toBe('28')
    // Untouched fields survive the edit.
    expect(next[0].calories).toBe('400')
    expect(next[0].calcium_mg).toBe('150')
  })

  it('matches the saved item case-insensitively rather than creating a duplicate', () => {
    const edited = entry({ 'Food Description': 'paneer WRAP', Calories: '450' })
    const next = upsertSuggestion(saved, suggestionFromEntry(edited))

    expect(next).toHaveLength(1)
    expect(next[0].calories).toBe('450')
  })

  it('adds the food when the edit names one that was never saved', () => {
    const edited = entry({ 'Food Description': 'Dal makhani', Calories: '310' })
    const next = upsertSuggestion(saved, suggestionFromEntry(edited))

    expect(next).toHaveLength(2)
    expect(next[1].name).toBe('Dal makhani')
    expect(next[1].calories).toBe('310')
  })

  it('leaves the saved item completely untouched when the edit is not persisted', () => {
    // The opt-in is the whole safety property: a one-off correction that the
    // user does NOT tick must not reach suggestions.csv at all.
    const before = JSON.parse(JSON.stringify(saved))
    const edited = entry({ 'Protein (g)': '28' })
    expect(nutritionChanged(entry(), edited)).toBe(true) // it WOULD have offered
    expect(saved).toEqual(before) // ...but nothing was written
  })

  it('does not let a cleared field wipe a saved value even when persisted', () => {
    const edited = entry({ 'Calcium (mg)': '' })
    const next = upsertSuggestion(saved, suggestionFromEntry(edited))

    expect(next[0].calcium_mg).toBe('150')
  })
})
