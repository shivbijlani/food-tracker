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

// Generate ½-serving, 1-serving, and 2-serving suggestion entries for recipes.
// Recipes store per-serving nutrition, so we scale accordingly.
// RECIPE_HEADERS: ['Recipe', 'Servings', 'Calories', 'Protein (g)', 'Calcium (mg)', 'Notes']
export function expandRecipeServings(recipes) {
  const out = []
  for (const r of recipes) {
    const name = (r.Recipe || '').trim()
    if (!name) continue
    const scale = (v, factor) => {
      const n = Number(v)
      if (!isFinite(n) || n <= 0) return ''
      const result = Math.round(n * factor * 10) / 10
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
      protein_g: String(r['Protein (g)'] || ''),
      calories:  String(r.Calories || ''),
      calcium_mg: String(r['Calcium (mg)'] || ''),
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

// Build an initial set of suggestions from existing history. Used as a
// one-time backfill when suggestions.csv doesn't yet exist.
// Pass advanced entries (with 'Food Description') and/or simple entries
// (with 'Meal' and 'Protein (g)'). Recipes are passed separately.
export function backfillFromHistory({ advancedEntries = [], simpleEntries = [], recipes = [] } = {}) {
  let list = []
  for (const r of recipes) {
    if (!r.Recipe) continue
    list = upsertSuggestion(list, {
      name: r.Recipe,
      protein_g: r['Protein (g)'],
      calories: r.Calories,
      calcium_mg: r['Calcium (mg)'],
    })
  }
  for (const e of advancedEntries) {
    const name = e['Food Description']
    if (!name) continue
    list = upsertSuggestion(list, {
      name,
      protein_g: e['Protein (g)'],
      calories: e.Calories,
      calcium_mg: e['Calcium (mg)'],
      veg_servings: e['Veg Servings'],
      omega3: e['Omega-3'],
    })
  }
  for (const e of simpleEntries) {
    const name = e.Meal
    if (!name) continue
    list = upsertSuggestion(list, {
      name,
      protein_g: e['Protein (g)'],
    })
  }
  return list
}
