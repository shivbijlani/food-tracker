// Grouping, summarising and clipboard-formatting for the Log view.
//
// Kept as pure functions (issue #58) so the same definitions drive the
// rendered summary and the copied text. If the copy button formatted its own
// totals, the clipboard could disagree with what is on screen — which is the
// class of drift that put the same bug in both Log modes before.

export const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snack']

// Entries with a blank or unrecognised Meal still have to appear somewhere, or
// copying a day would silently drop food the user ate.
export const UNGROUPED_MEAL = 'Other'

function num(v) {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

/** Sum the nutrition columns across a set of entries. */
export function mealTotals(entries = []) {
  const t = entries.reduce((a, e) => ({
    cal: a.cal + num(e.Calories),
    pro: a.pro + num(e['Protein (g)']),
    ca: a.ca + num(e['Calcium (mg)']),
    veg: a.veg + num(e['Veg Servings']),
    water: a.water + num(e['Water (oz)']),
    omega3: a.omega3 || e['Omega-3'] === 'Y',
  }), { cal: 0, pro: 0, ca: 0, veg: 0, water: 0, omega3: false })

  return {
    ...t,
    veg: Math.round(t.veg * 2) / 2,
    water: Math.round(t.water * 2) / 2,
    count: entries.length,
  }
}

/**
 * Group one day's entries by meal, in menu order rather than insertion order.
 * Meals with no entries are omitted, so an untouched day never renders four
 * empty headers.
 */
export function groupByMeal(entries = []) {
  const buckets = new Map()
  for (const e of entries) {
    const raw = (e.Meal || '').trim()
    const meal = MEAL_ORDER.includes(raw) ? raw : UNGROUPED_MEAL
    if (!buckets.has(meal)) buckets.set(meal, [])
    buckets.get(meal).push(e)
  }

  const order = [...MEAL_ORDER, UNGROUPED_MEAL]
  return order
    .filter(m => buckets.has(m))
    .map(meal => ({ meal, entries: buckets.get(meal), totals: mealTotals(buckets.get(meal)) }))
}

/**
 * The condensed one-liner shown next to a meal heading. Zero-valued nutrients
 * are dropped so a quick-add with no nutrition reads "1 item" instead of a row
 * of zeroes pretending to be data.
 */
export function formatMealSummary(totals) {
  const t = totals || mealTotals([])
  const parts = [`${t.count} ${t.count === 1 ? 'item' : 'items'}`]
  if (t.cal) parts.push(`${Math.round(t.cal)} kcal`)
  if (t.pro) parts.push(`${Math.round(t.pro)}g pro`)
  if (t.ca) parts.push(`${Math.round(t.ca)}mg Ca`)
  if (t.veg) parts.push(`${t.veg} veg`)
  if (t.water) parts.push(`${Math.round(t.water)}oz water`)
  if (t.omega3) parts.push('ω-3')
  return parts.join(' · ')
}

function entryLine(e) {
  const desc = (e['Food Description'] || '').trim() || '(no description)'
  const bits = []
  if (num(e.Calories)) bits.push(`${Math.round(num(e.Calories))} kcal`)
  if (num(e['Protein (g)'])) bits.push(`${Math.round(num(e['Protein (g)']))}g protein`)
  return bits.length ? `- ${desc} — ${bits.join(', ')}` : `- ${desc}`
}

/**
 * Plain text for the clipboard. Deliberately plain — the point of the ask is
 * pasting into another app, so no markdown tables and no emoji.
 */
export function mealToText(group, date) {
  if (!group) return ''
  const header = date ? `${group.meal} — ${date}` : group.meal
  const lines = [header, ...group.entries.map(entryLine)]
  const summary = formatMealSummary(group.totals)
  if (summary) lines.push(`Total: ${summary}`)
  return lines.join('\n')
}

/** The whole day, meal by meal, in the same order it is displayed. */
export function dayToText(entries, date) {
  const groups = groupByMeal(entries)
  if (groups.length === 0) return date ? `${date}\n(no entries)` : '(no entries)'
  const blocks = groups.map(g => mealToText(g, null))
  const head = date ? `${date}` : null
  const foot = `Day total: ${formatMealSummary(mealTotals(entries))}`
  return [head, ...blocks, foot].filter(Boolean).join('\n\n')
}

/**
 * The copy click, as a pure function so it can be asserted without a DOM.
 * Returns whether the copy succeeded.
 */
export async function handleCopyClick(ev, { getText, onCopy = copyText, setState = () => {} }) {
  // The button sits inside a <summary>; without this a copy would also toggle
  // the disclosure, which reads as the click having done the wrong thing.
  if (ev) {
    ev.stopPropagation?.()
    ev.preventDefault?.()
  }
  const ok = await onCopy(getText())
  setState(ok ? 'done' : 'failed')
  return ok
}

/**
 * Clipboard write that reports success instead of throwing, so the caller can
 * show "Copied"/"Copy failed" rather than dying inside an onClick handler.
 * Falls back to execCommand for the non-secure-origin case (plain http on a
 * phone on the LAN), where navigator.clipboard is undefined.
 */
export async function copyText(text, nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  if (!text) return false
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    if (typeof document === 'undefined' || !document.execCommand) return false
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return !!ok
  } catch {
    return false
  }
}
