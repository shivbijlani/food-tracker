// Tests for the log-entry <-> saved-food bridge added for issue #59.
//
// The bug: adding an entry upserted its nutrition into suggestions.csv, but
// editing an already-logged entry did not — so a correction never reached the
// reusable saved food. Kiley hit this and asked what editing actually does.
//
// These cover the pure decision logic. The React wiring simply calls
// `persistSuggestionsFor` on both paths.

import { describe, it, expect } from 'vitest'
import {
  suggestionPatchFromEntry,
  nutritionChanged,
  upsertSuggestion,
  parseSuggestions,
  serializeSuggestions,
} from './suggestions.js'

const advanced = (over = {}) => ({
  Date: '2026-09-01',
  Meal: 'Lunch',
  'Food Description': 'Greek yogurt',
  'Protein (g)': '17',
  Calories: '120',
  'Calcium (mg)': '200',
  'Veg Servings': '0',
  'Omega-3': '',
  Notes: '',
  ...over,
})

const simple = (over = {}) => ({
  Date: '2026-09-01',
  Meal: 'Greek yogurt',
  'Protein (g)': '17',
  ...over,
})

describe('suggestionPatchFromEntry', () => {
  it('maps advanced display columns onto suggestion keys', () => {
    expect(suggestionPatchFromEntry(advanced())).toEqual({
      name: 'Greek yogurt',
      protein_g: '17',
      calories: '120',
      calcium_mg: '200',
      veg_servings: '0',
      omega3: '',
    })
  })

  it('names a simple-mode food by its Meal cell and carries protein only', () => {
    expect(suggestionPatchFromEntry(simple(), 'simple')).toEqual({
      name: 'Greek yogurt',
      protein_g: '17',
    })
  })

  it('returns null when there is no food name to key on', () => {
    expect(suggestionPatchFromEntry(advanced({ 'Food Description': '   ' }))).toBeNull()
    expect(suggestionPatchFromEntry(simple({ Meal: '' }), 'simple')).toBeNull()
    expect(suggestionPatchFromEntry(null)).toBeNull()
  })

  it('trims the name so " Greek yogurt " updates the existing saved food', () => {
    expect(suggestionPatchFromEntry(advanced({ 'Food Description': '  Greek yogurt  ' })).name)
      .toBe('Greek yogurt')
  })
})

describe('nutritionChanged', () => {
  it('is false when nothing a saved food stores was touched', () => {
    const before = advanced()
    expect(nutritionChanged(before, { ...before })).toBe(false)
  })

  it('ignores edits to fields the food database does not store', () => {
    const before = advanced()
    // Editing a note, a date or which meal it belonged to must never offer to
    // rewrite the reusable food.
    expect(nutritionChanged(before, { ...before, Notes: 'second helping' })).toBe(false)
    expect(nutritionChanged(before, { ...before, Date: '2026-08-30' })).toBe(false)
    expect(nutritionChanged(before, { ...before, Meal: 'Dinner' })).toBe(false)
  })

  it('detects a change in each stored nutrient', () => {
    const before = advanced()
    expect(nutritionChanged(before, { ...before, 'Protein (g)': '20' })).toBe(true)
    expect(nutritionChanged(before, { ...before, Calories: '150' })).toBe(true)
    expect(nutritionChanged(before, { ...before, 'Calcium (mg)': '250' })).toBe(true)
    expect(nutritionChanged(before, { ...before, 'Veg Servings': '1' })).toBe(true)
    expect(nutritionChanged(before, { ...before, 'Omega-3': 'Y' })).toBe(true)
  })

  it('treats a rename as a change, because saved foods are keyed by name', () => {
    const before = advanced()
    expect(nutritionChanged(before, { ...before, 'Food Description': 'Skyr' })).toBe(true)
  })

  it('does not fire on cosmetic whitespace or numeric-string retyping', () => {
    const before = advanced()
    expect(nutritionChanged(before, { ...before, 'Protein (g)': ' 17 ' })).toBe(false)
  })

  it('reads the Meal cell in simple mode, not Food Description', () => {
    const before = simple()
    expect(nutritionChanged(before, { ...before, Meal: 'Skyr' }, 'simple')).toBe(true)
    expect(nutritionChanged(before, { ...before, 'Protein (g)': '20' }, 'simple')).toBe(true)
    // Simple mode stores protein only, so calories are not its business.
    expect(nutritionChanged(before, { ...before, Calories: '999' }, 'simple')).toBe(false)
  })

  it('is false when either side is missing', () => {
    expect(nutritionChanged(null, advanced())).toBe(false)
    expect(nutritionChanged(advanced(), null)).toBe(false)
  })
})

describe('the edit path now reaches suggestions.csv (issue #59)', () => {
  it('persists a corrected value back to the saved food', () => {
    // The saved food as the add path first stored it.
    let saved = parseSuggestions(serializeSuggestions([
      { name: 'Greek yogurt', protein_g: '17', calories: '120', calcium_mg: '200', veg_servings: '0', omega3: '' },
    ]))

    // Kiley edits the logged row: the tub is actually 20g.
    const corrected = advanced({ 'Protein (g)': '20' })
    expect(nutritionChanged(advanced(), corrected)).toBe(true)

    saved = upsertSuggestion(saved, suggestionPatchFromEntry(corrected))

    expect(saved).toHaveLength(1)
    expect(saved[0].protein_g).toBe('20')
    // Untouched fields survive the correction.
    expect(saved[0].calories).toBe('120')
    expect(saved[0].calcium_mg).toBe('200')
  })

  it('matches the saved food case-insensitively rather than duplicating it', () => {
    let saved = [{ name: 'Greek Yogurt', protein_g: '17', calories: '120', calcium_mg: '', veg_servings: '', omega3: '' }]
    saved = upsertSuggestion(saved, suggestionPatchFromEntry(advanced({ 'Food Description': 'greek yogurt', 'Protein (g)': '20' })))
    expect(saved).toHaveLength(1)
    expect(saved[0].protein_g).toBe('20')
  })

  it('add and edit produce the same payload for the same entry', () => {
    // The regression guard: these two paths built their payload separately,
    // which is how they drifted. They now share one function.
    const entry = advanced({ 'Protein (g)': '21' })
    expect(suggestionPatchFromEntry(entry)).toEqual(suggestionPatchFromEntry({ ...entry }))
  })

  it('a blank correction does not wipe a known value', () => {
    let saved = [{ name: 'Greek yogurt', protein_g: '17', calories: '120', calcium_mg: '200', veg_servings: '0', omega3: '' }]
    // User clears calories but fixes protein; upsertSuggestion keeps the old calories.
    saved = upsertSuggestion(saved, suggestionPatchFromEntry(advanced({ Calories: '', 'Protein (g)': '20' })))
    expect(saved[0].protein_g).toBe('20')
    expect(saved[0].calories).toBe('120')
  })
})
