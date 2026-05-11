// Helpers to merge entries that share Date+Meal into a single row, instead
// of appending a new row every time the user logs another bite.

const NUMERIC_FIELDS = ['Calories', 'Protein (g)', 'Calcium (mg)', 'Veg Servings']

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function joinDescriptions(a, b) {
  const A = String(a || '').trim()
  const B = String(b || '').trim()
  if (!A) return B
  if (!B) return A
  if (A === B) return A
  return `${A}, ${B}`
}

function joinNotes(a, b) {
  const A = String(a || '').trim()
  const B = String(b || '').trim()
  if (!A) return B
  if (!B) return A
  if (A === B) return A
  return `${A}; ${B}`
}

function mergeOmega3(a, b) {
  const yes = (v) => /^(y|yes|true|1)$/i.test(String(v || '').trim())
  return (yes(a) || yes(b)) ? 'Y' : (a || b || '')
}

/**
 * Merge a new entry into the existing list. If an entry with the same
 * Date+Meal already exists, sum the numerics and append the description /
 * notes. Otherwise prepend.
 *
 * Mode controls which fields are merged:
 *   - 'advanced': Food Description, Calories, Protein (g), Calcium (mg),
 *                 Veg Servings, Omega-3, Notes
 *   - 'simple':   Protein (g) only
 */
export function mergeEntry(entries, entry, mode = 'advanced') {
  const date = entry.Date
  if (!date) return [entry, ...entries]

  let idx
  if (mode === 'simple') {
    // Simple mode has no meal-type bucket; merge anything on the same date.
    idx = entries.findIndex(e => e.Date === date)
  } else {
    const meal = (entry.Meal || '').trim()
    idx = entries.findIndex(e => e.Date === date && (e.Meal || '').trim() === meal)
  }
  if (idx < 0) return [entry, ...entries]

  const existing = entries[idx]
  let merged
  if (mode === 'simple') {
    merged = {
      ...existing,
      Date: date,
      Meal: joinDescriptions(existing.Meal, entry.Meal),
      'Protein (g)': num(existing['Protein (g)']) + num(entry['Protein (g)']),
    }
  } else {
    const meal = (entry.Meal || '').trim()
    merged = {
      ...existing,
      Date: date,
      Meal: meal,
      'Food Description': joinDescriptions(existing['Food Description'], entry['Food Description']),
      Notes: joinNotes(existing.Notes, entry.Notes),
      'Omega-3': mergeOmega3(existing['Omega-3'], entry['Omega-3']),
    }
    for (const f of NUMERIC_FIELDS) {
      merged[f] = num(existing[f]) + num(entry[f])
    }
  }

  const next = entries.slice()
  next[idx] = merged
  return next
}

/** Replace the entry at index `idx` with `entry`. */
export function updateEntryAt(entries, idx, entry) {
  if (idx < 0 || idx >= entries.length) return entries
  const next = entries.slice()
  next[idx] = entry
  return next
}
