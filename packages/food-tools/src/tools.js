import { readEntries, writeEntries } from './mdyaml.js'
import { DAILY_LOG_HEADERS, PROTEIN_LOG_HEADERS, RECIPE_HEADERS } from './markdown.js'
import { addLogEntries } from './mergeEntry.js'
import { parseSuggestions, composeSuggestions, filterSuggestions } from './suggestions.js'

export const VERSION = '1.0.0'
export class ToolError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
export function requireValue(condition, message) {
  if (!condition) throw new ToolError('INVALID_INPUT', message)
}
export function checkDate(date) {
  requireValue(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date, 'Use a valid YYYY-MM-DD date.')
}
const modes = ['advanced', 'simple']
const fields = { protein_g: 'Protein (g)', calories: 'Calories', calcium_mg: 'Calcium (mg)', veg_servings: 'Veg Servings', water_oz: 'Water (oz)' }
const stable = value => JSON.stringify(value, function (key, v) {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v
})
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const logName = (mode, date) => `${mode === 'simple' ? 'protein' : 'entries'}-${date.slice(0, 7)}.md`
const headersFor = mode => mode === 'simple' ? PROTEIN_LOG_HEADERS : DAILY_LOG_HEADERS

async function catalog(store, mode) {
  const [foods, recipes] = await Promise.all([store.read('suggestions.csv'), store.read('recipes.md')])
  const saved = parseSuggestions(foods.content || '')
  const recipeRows = readEntries(recipes.content || '', RECIPE_HEADERS).rows
  const items = composeSuggestions(recipeRows, saved, mode).map(s => {
    return {
      ...s,
      optionId: `${s.source.file}:${encodeURIComponent(s.name.toLowerCase())}`,
    }
  })
  return { revision: await digest({ foods: foods.content, recipes: recipes.content, mode }), items }
}

export async function prepareFoodLog(store, { items, mode = 'advanced' }) {
  requireValue(modes.includes(mode), 'mode must be advanced or simple.')
  requireValue(Array.isArray(items) && items.length > 0 && items.length <= 50 &&
    items.every(q => typeof q === 'string' && q.trim() && q.length <= 500), 'Provide 1-50 nonempty item descriptions.')
  const cat = await catalog(store, mode)
  const toOption = s => ({
    optionId: s.optionId, name: s.name, source: s.source,
    nutrition: Object.fromEntries([...Object.keys(fields), 'omega3'].map(k => [k, s[k] ?? ''])),
  })
  return {
    apiVersion: 1, mode, catalogRevision: cat.revision,
    items: items.map(query => {
      const options = filterSuggestions(cat.items, query, 30).map(toOption)
      return options.length ? { query, options } : {
        query, options,
        hint: 'No saved food matched this text. Check savedFoods: if one is the same food, select its optionId and scale quantity; otherwise estimate protein_g yourself for this exact portion (calibrate against similar savedFoods) and log it as newFood with nutritionStatus "estimated".',
      }
    }),
    savedFoods: cat.items.filter(s => s.name === s.source.name || !/^half\s+/i.test(s.name)).slice(0, 500).map(s => ({
      optionId: s.optionId, name: s.name,
      nutrition: Object.fromEntries([...Object.keys(fields), 'omega3'].filter(k => s[k] !== '' && s[k] != null).map(k => [k, s[k]])),
    })),
    guidance: 'Prefer saved foods: if an item\'s options or savedFoods contain the same food in a different amount, select its optionId and compute quantity as described portion / saved portion (e.g. "1.5oz chicken" with saved "1oz Rotisserie chicken" -> quantity 1.5; "half a shake" -> 0.5). The saved nutrition is then scaled for you. Only if no saved food is the same food, use newFood and estimate the nutrition yourself: you are the estimator, so reason from the described food and portion, calibrating against similar savedFoods (the user\'s own portions and values) and typical USDA values, to a best-guess protein_g, and set nutritionStatus "estimated". Never leave protein blank or ask the user for numbers just because the food is new; other fields may stay blank. Do not replace saved nutrition.',
  }
}

function nutritionRow(nutrition, quantity) {
  requireValue(nutrition && typeof nutrition === 'object' && !Array.isArray(nutrition), 'nutrition must be an object.')
  requireValue(Object.keys(nutrition).every(k => k in fields || k === 'omega3'), 'Unsupported nutrition field.')
  const row = {}
  for (const [key, column] of Object.entries(fields)) {
    const value = nutrition[key]
    const unknown = value === '' || value === undefined || value === null
    requireValue(unknown || ((typeof value === 'number' || typeof value === 'string') &&
      Number.isFinite(Number(value)) && Number(value) >= 0), `Invalid ${key}.`)
    row[column] = unknown ? '' : String(Math.round(Number(value) * quantity * 100) / 100)
  }
  requireValue(nutrition.omega3 == null || ['', 'Y', 'N'].includes(nutrition.omega3), 'omega3 must be Y, N or blank.')
  row['Omega-3'] = nutrition.omega3 || ''
  return row
}

function selectedRows(preparation, selections, date, meal, operationId) {
  return selections.map((selection, i) => {
    requireValue(selection && typeof selection === 'object', 'Each selection must be an object.')
    const { optionId, newFood, quantity } = selection
    requireValue(typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0 && quantity <= 1000, 'quantity must be > 0 and <= 1000.')
    requireValue(Boolean(optionId) !== Boolean(newFood), 'Select exactly one optionId or explicit newFood.')
    let name, nutrition, note
    if (optionId) {
      const option = preparation.items[i].options.find(o => o.optionId === optionId) ||
        preparation.savedFoods.find(o => o.optionId === optionId)
      requireValue(option, `Item ${i + 1}: optionId must come from its options or savedFoods.`)
      requireValue(preparation.mode !== 'simple' || (option.nutrition.protein_g !== '' && option.nutrition.protein_g != null),
        `Item ${i + 1}: saved food "${option.name}" has no protein value. Log it as newFood with your own protein_g estimate (nutritionStatus "estimated") instead.`)
      name = option.name
      nutrition = option.nutrition
      note = option.source ? `Saved nutrition; source ${option.source.file}: ${option.source.name}` : `Saved nutrition; source ${option.optionId.split(':')[0]}: ${name}`
    } else {
      requireValue(typeof newFood.name === 'string' && newFood.name.trim() && newFood.name.length <= 500 &&
        !/[\r\n|]/.test(newFood.name), 'newFood.name must be a nonempty single-line food name.')
      requireValue(['estimated', 'provided'].includes(newFood.nutritionStatus), 'newFood requires nutritionStatus "estimated" or "provided". If the user gave no numbers, estimate them yourself and use "estimated".')
      nutrition = newFood.nutrition || {}
      const protein = nutrition.protein_g
      requireValue((typeof protein === 'number' || (typeof protein === 'string' && protein.trim())) &&
        Number.isFinite(Number(protein)) && Number(protein) >= 0, 'newFood requires nutrition.protein_g. Estimate it yourself from the food and portion (typical USDA values), set nutritionStatus "estimated", and retry.')
      name = newFood.name.trim()
      note = `New food; nutrition ${newFood.nutritionStatus}; not added to saved catalog`
    }
    const row = {
      Date: date, Meal: preparation.mode === 'simple' ? name : meal,
      'Food Description': name, ...nutritionRow(nutrition, quantity),
      Notes: `${note}; quantity ${quantity}`, Id: `${operationId}:${i}`,
    }
    return row
  })
}

export async function commitFoodLog(store, args) {
  const { preparation, selections, date, meal, operationId } = args
  checkDate(date)
  requireValue(preparation?.apiVersion === 1 && modes.includes(preparation.mode) &&
    typeof preparation.catalogRevision === 'string' && Array.isArray(preparation.items), 'Pass the complete prepare_food_log result.')
  requireValue(typeof meal === 'string' && meal.trim() && meal.length <= 100 && !/[\r\n|]/.test(meal), 'Provide a single-line meal label.')
  requireValue(typeof operationId === 'string' && operationId.startsWith(`${preparation.mode}:${date}:`) &&
    /^[a-zA-Z0-9:_-]{20,160}$/.test(operationId), 'operationId must be mode:YYYY-MM-DD:stable-unique-id (20-160 safe characters).')
  requireValue(Array.isArray(selections) && selections.length > 0 && selections.length === preparation.items.length, 'Provide one selection for each prepared item.')
  const requestHash = await digest({ mode: preparation.mode, queries: preparation.items.map(i => i.query), selections, date, meal })
  const filename = logName(preparation.mode, date)
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await store.read(filename)
    const parsed = readEntries(snapshot.content || '', headersFor(preparation.mode))
    const operations = parsed.meta.foodOperations || []
    requireValue(Array.isArray(operations), 'Malformed foodOperations metadata; repair before logging.')
    const receipts = operations.map(r => {
      try { return JSON.parse(decodeURIComponent(r)) }
      catch { throw new ToolError('INVALID_DATA', 'Malformed operation receipt; repair before logging.') }
    })
    const prior = receipts.find(r => r.operationId === operationId)
    if (prior) {
      if (prior.requestHash !== requestHash) throw new ToolError('OPERATION_CONFLICT', 'This operationId was used with different input.')
      return { ...prior.result, duplicate: true }
    }
    const fresh = await prepareFoodLog(store, { mode: preparation.mode, items: preparation.items.map(i => i.query) })
    if (fresh.catalogRevision !== preparation.catalogRevision) throw new ToolError('STALE_PREPARATION', 'The saved catalog changed. Prepare again and review the new choices.')
    const rows = selectedRows(fresh, selections, date, meal, operationId)
    // Recheck the catalog immediately before the conditional log write.
    if ((await catalog(store, preparation.mode)).revision !== fresh.catalogRevision) {
      throw new ToolError('STALE_PREPARATION', 'The saved catalog changed. Prepare again.')
    }
    const result = { operationId, file: filename, entryIds: rows.map(r => r.Id), entries: rows, duplicate: false }
    const content = writeEntries(snapshot.content || '', headersFor(preparation.mode), addLogEntries(parsed.rows, rows), {
      kind: 'entries', mode: preparation.mode, period: date.slice(0, 7),
      foodOperations: [...operations, encodeURIComponent(stable({ operationId, requestHash, result }))],
    })
    try {
      await store.write(filename, content, snapshot)
      return result
    } catch (e) {
      if (e.code !== 'PRECONDITION_FAILED') throw e
      // The operation is reapplied to a newly read file, not a stale body.
    }
  }
  throw new ToolError('CONCURRENT_UPDATE', 'The log kept changing. Retry with the same operationId.')
}

export async function getDay(store, { date, mode = 'advanced' }) {
  checkDate(date)
  requireValue(modes.includes(mode), 'mode must be advanced or simple.')
  const snapshot = await store.read(logName(mode, date))
  const entries = readEntries(snapshot.content || '', headersFor(mode)).rows.filter(e => e.Date === date)
  const totals = {}
  for (const [key, column] of Object.entries(fields)) {
    if (mode === 'simple' && key !== 'protein_g') continue
    let known = 0, unknownEntries = 0
    for (const e of entries) {
      const v = e[column]
      if (v == null || v === '' || !Number.isFinite(Number(v))) unknownEntries++
      else known += Number(v)
    }
    totals[key] = { known: Math.round(known * 100) / 100, unknownEntries, complete: unknownEntries === 0 }
  }
  if (mode === 'advanced') {
    const unknownEntries = entries.filter(e => !['Y', 'N'].includes(e['Omega-3'])).length
    totals.omega3 = { known: entries.filter(e => e['Omega-3'] === 'Y').length, unknownEntries, complete: unknownEntries === 0 }
  }
  return { date, mode, entries, totals }
}

export function createTools(store) {
  return {
    prepare_food_log: args => prepareFoodLog(store, args),
    commit_food_log: args => commitFoodLog(store, args),
    get_day: args => getDay(store, args),
  }
}
