// suggestions.csv — a per-folder food database for autocomplete.
//
// Schema (header row, comma-separated):
//   name,protein_g,calories,calcium_mg,veg_servings,omega3
//
// - `name` is unique (case-insensitive). Upserts replace prior values.
// - Numeric fields may be blank (simple-mode entries only carry protein).
// - `omega3` is 'Y' / 'N' / '' (blank treated as 'N' when chosen).
// - We keep this as a separate file from entries-YYYY-MM.md so the food
//   database persists / syncs independently of the day-by-day log.
//
// The file is created lazily on first save (no scaffolding — see PR #36).
// Sync is automatic: storage.writeFile() queues for OneDrive / Google Drive.

export const SUGGESTIONS_FILE = 'suggestions.csv'
export const SUGGESTION_COLUMNS = ['name', 'protein_g', 'calories', 'calcium_mg', 'veg_servings', 'omega3']

// ---- CSV helpers (minimal but quote-aware) ----

function parseLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map(v => v.trim())
}

function quoteIfNeeded(v) {
  const s = String(v ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ---- Public API ----

export function parseSuggestions(text) {
  if (!text || !text.trim()) return []
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 1) return []
  const headers = parseLine(lines[0]).map(h => h.toLowerCase())
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i])
    const obj = {}
    headers.forEach((h, j) => { obj[h] = cells[j] ?? '' })
    if (!obj.name) continue
    out.push(obj)
  }
  return out
}

export function serializeSuggestions(items) {
  const header = SUGGESTION_COLUMNS.join(',')
  const rows = items.map(it =>
    SUGGESTION_COLUMNS.map(c => quoteIfNeeded(it[c] ?? '')).join(',')
  )
  return [header, ...rows].join('\n') + '\n'
}

// Returns a new list with `incoming` upserted (deduped by lowercased name).
// Empty fields on `incoming` do not clobber existing non-empty values —
// this matters for simple mode (only protein known) updating advanced entries.
export function upsertSuggestion(items, incoming) {
  const name = (incoming.name || '').trim()
  if (!name) return items
  const key = name.toLowerCase()
  const next = []
  let replaced = false
  for (const it of items) {
    if ((it.name || '').trim().toLowerCase() === key) {
      const merged = { ...it }
      for (const col of SUGGESTION_COLUMNS) {
        const v = incoming[col]
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          merged[col] = String(v)
        }
      }
      merged.name = name
      next.push(merged)
      replaced = true
    } else {
      next.push(it)
    }
  }
  if (!replaced) {
    const fresh = { name }
    for (const col of SUGGESTION_COLUMNS) {
      if (col === 'name') continue
      const v = incoming[col]
      fresh[col] = (v === undefined || v === null) ? '' : String(v)
    }
    next.push(fresh)
  }
  return next
}

// ---- Log entry <-> suggestion bridge (issue #59) ----
//
// A log entry uses display column names ('Food Description', 'Protein (g)'…)
// while suggestions.csv uses short keys. Both the add path and the edit path
// need the same translation, so it lives here rather than in App.jsx — that
// duplication is what let the two paths drift apart in the first place.
//
// The two modes disagree on shape: advanced names a food in 'Food Description'
// and stores five nutrients; simple names it in 'Meal' and stores protein only.

const FIELD_MAP = Object.freeze({
  advanced: {
    nameCol: 'Food Description',
    fields: {
      'Protein (g)': 'protein_g',
      'Calories': 'calories',
      'Calcium (mg)': 'calcium_mg',
      'Veg Servings': 'veg_servings',
      'Omega-3': 'omega3',
    },
  },
  simple: {
    nameCol: 'Meal',
    fields: { 'Protein (g)': 'protein_g' },
  },
})

// Build the upsert payload for a log entry, or null when the entry has no
// food name to key on. Blank fields are preserved as blanks so upsertSuggestion
// can apply its own "don't clobber with empty" rule.
export function suggestionPatchFromEntry(entry, mode = 'advanced') {
  const map = FIELD_MAP[mode] || FIELD_MAP.advanced
  const name = ((entry && entry[map.nameCol]) || '').trim()
  if (!name) return null
  const patch = { name }
  for (const [entryCol, suggestionCol] of Object.entries(map.fields)) {
    patch[suggestionCol] = entry[entryCol]
  }
  return patch
}

// True when an edit changed any value that a saved food actually stores.
// Renaming the food counts: the saved item is keyed by name, so a rename
// targets a different saved food entirely.
//
// Used to decide whether to even offer "update the saved values" — editing a
// note or a date must never touch the food database.
export function nutritionChanged(before, after, mode = 'advanced') {
  if (!before || !after) return false
  const map = FIELD_MAP[mode] || FIELD_MAP.advanced
  const norm = (v) => (v === undefined || v === null) ? '' : String(v).trim()
  if (norm(before[map.nameCol]) !== norm(after[map.nameCol])) return true
  return Object.keys(map.fields).some(col => norm(before[col]) !== norm(after[col]))
}

// Number of servings a recipe yields. Recipes store whole-recipe totals, so
// this is the divisor used to derive per-serving nutrition. Blank/invalid
// values fall back to 1 (treat the recipe as a single serving).
export function recipeServingsCount(r) {
  const n = Number(r && r.Servings)
  return isFinite(n) && n > 0 ? n : 1
}

// Generate ½-serving, 1-serving, and 2-serving suggestion entries for recipes.
// Recipes store WHOLE-RECIPE totals plus a Servings count, so per-serving
// nutrition is total / servings; we then scale that by the portion factor.
// RECIPE_HEADERS: ['Recipe', 'Servings', 'Calories', 'Protein (g)', 'Calcium (mg)', 'Notes']
export function expandRecipeServings(recipes) {
  const out = []
  for (const r of recipes) {
    const name = (r.Recipe || '').trim()
    if (!name) continue
    const servings = recipeServingsCount(r)
    const scale = (v, factor) => {
      const n = Number(v)
      if (!isFinite(n) || n <= 0) return ''
      const result = Math.round((n / servings) * factor * 10) / 10
      return String(result).replace(/\.0$/, '')
    }
    out.push({
      name: `½ serving of ${name}`,
      protein_g: scale(r['Protein (g)'], 0.5),
      calories:  scale(r.Calories, 0.5),
      calcium_mg: scale(r['Calcium (mg)'], 0.5),
      veg_servings: '',
      omega3: '',
    })
    out.push({
      name: `1 serving of ${name}`,
      protein_g: scale(r['Protein (g)'], 1),
      calories:  scale(r.Calories, 1),
      calcium_mg: scale(r['Calcium (mg)'], 1),
      veg_servings: '',
      omega3: '',
    })
    out.push({
      name: `2 servings of ${name}`,
      protein_g: scale(r['Protein (g)'], 2),
      calories:  scale(r.Calories, 2),
      calcium_mg: scale(r['Calcium (mg)'], 2),
      veg_servings: '',
      omega3: '',
    })
  }
  return out
}

// Generate virtual "Half {name}" variants for items with usable nutrition.
// These are NOT stored — they're recomputed at read time. We skip items that
// already start with "Half " to prevent stacking ("Half Half X").
export function expandWithHalves(items) {
  const out = []
  for (const it of items) {
    out.push(it)
    const name = (it.name || '').trim()
    if (!name) continue
    if (/^half\s+/i.test(name)) continue
    const halve = (v) => {
      const n = Number(v)
      if (!isFinite(n) || n <= 0) return ''
      // Round to 1 decimal, drop trailing .0
      const h = Math.round((n / 2) * 10) / 10
      return String(h).replace(/\.0$/, '')
    }
    out.push({
      name: `Half ${name}`,
      protein_g: halve(it.protein_g),
      calories: halve(it.calories),
      calcium_mg: halve(it.calcium_mg),
      veg_servings: halve(it.veg_servings),
      omega3: '', // halving an omega-3 flag is meaningless
    })
  }
  return out
}
