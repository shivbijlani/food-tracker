#!/usr/bin/env node
/**
 * Usage: node scripts/bootstrap-kiley.js <output-folder>
 *
 * Reads Kiley's Excel food log and writes advanced mode markdown files:
 *   daily-log.md, goals.md, recipes.md
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Use xlsx from global npm modules
const XLSX_PATH = 'C:\\Users\\shiv\\AppData\\Roaming\\npm\\node_modules\\xlsx'
const XLSX = require(XLSX_PATH)

const EXCEL_PATH = 'C:\\Users\\shiv\\OneDrive\\Documents (Shared)\\Food and Recipes\\Kiley_Food_Log.xlsx'

const outFolder = path.resolve(process.argv[2] || '.')

if (!process.argv[2]) {
  console.error('Usage: node scripts/bootstrap-kiley.js <output-folder>')
  process.exit(1)
}

fs.mkdirSync(outFolder, { recursive: true })

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function serializeTable(headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`
  const sepLine = `|${headers.map(() => '------').join('|')}|`
  const bodyLines = rows.map(r => `| ${r.map(escapeCell).join(' | ')} |`)
  return [headerLine, sepLine, ...bodyLines].join('\n')
}

function formatDate(raw) {
  if (!raw) return ''
  // Excel date serial or string
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (!d) return String(raw)
    const mm = String(d.m).padStart(2, '0')
    const dd = String(d.d).padStart(2, '0')
    return `${d.y}-${mm}-${dd}`
  }
  // Already a string — try to normalize
  const s = String(raw).trim()
  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // Try Date parse
  const d = new Date(s)
  if (!isNaN(d)) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return s
}

// ── Read workbook ─────────────────────────────────────────────────────────────
console.log(`Reading: ${EXCEL_PATH}`)
const wb = XLSX.readFile(EXCEL_PATH)

// ── daily-log.md ─────────────────────────────────────────────────────────────
const DAILY_LOG_HEADERS = ['Date', 'Meal', 'Food Description', 'Calories', 'Protein (g)', 'Calcium (mg)', 'Veg Servings', 'Omega-3', 'Notes']

const logSheet = wb.Sheets['Daily Log']
if (!logSheet) {
  console.warn('Warning: "Daily Log" sheet not found in workbook. Skipping daily-log.md.')
} else {
  const rows = XLSX.utils.sheet_to_json(logSheet, { defval: '' })
  const tableRows = rows.map(r => [
    formatDate(r['Date'] ?? r['date'] ?? ''),
    String(r['Meal'] ?? ''),
    String(r['Food Description'] ?? ''),
    String(r['Calories'] ?? ''),
    String(r['Protein (g)'] ?? ''),
    String(r['Calcium (mg)'] ?? ''),
    String(r['Veg Servings'] ?? ''),
    String(r['Omega-3 (Y/N)'] ?? r['Omega-3'] ?? ''),
    String(r['Notes'] ?? ''),
  ])
  const content = `# Daily Food Log\n\nThis file is the source of truth for all logged meals.\n\n${serializeTable(DAILY_LOG_HEADERS, tableRows)}\n`
  fs.writeFileSync(path.join(outFolder, 'daily-log.md'), content, 'utf8')
  console.log(`Wrote daily-log.md (${tableRows.length} rows)`)
}

// ── goals.md ──────────────────────────────────────────────────────────────────
const GOALS_HEADERS = ['Nutrient', 'Target', 'Notes']

// Use hardcoded data (from spec)
const goalsData = [
  { 'Nutrient / Metric': 'Protein', Target: '90–120 g/day', Notes: 'Muscle building, satiety, weight loss support' },
  { 'Nutrient / Metric': 'Calcium', Target: '1000–1200 mg/day', Notes: 'Bone consolidation' },
  { 'Nutrient / Metric': 'Vegetables', Target: '5+ servings/day', Notes: 'Fiber, vitamins' },
  { 'Nutrient / Metric': 'Omega-3s', Target: 'Daily', Notes: 'Brain recovery after concussion' },
  { 'Nutrient / Metric': 'Calories', Target: '~1400–1600 kcal/day', Notes: 'Gentle deficit' },
]

// Try reading from sheet first, fall back to hardcoded
let goalsRows
const goalsSheet = wb.Sheets['Goals']
if (goalsSheet) {
  try {
    const sheetRows = XLSX.utils.sheet_to_json(goalsSheet, { defval: '' })
    goalsRows = sheetRows.map(r => [
      String(r['Nutrient / Metric'] ?? r['Nutrient'] ?? ''),
      String(r['Target'] ?? ''),
      String(r['Notes'] ?? ''),
    ]).filter(r => r[0])
  } catch (e) {
    goalsRows = null
  }
}
if (!goalsRows || goalsRows.length === 0) {
  goalsRows = goalsData.map(r => [r['Nutrient / Metric'], r.Target, r.Notes])
}

const goalsContent = `# Daily Nutrition Goals\n\n${serializeTable(GOALS_HEADERS, goalsRows)}\n`
fs.writeFileSync(path.join(outFolder, 'goals.md'), goalsContent, 'utf8')
console.log(`Wrote goals.md (${goalsRows.length} rows)`)

// ── recipes.md ────────────────────────────────────────────────────────────────
const RECIPE_HEADERS = ['Recipe', 'Servings', 'Calories', 'Protein (g)', 'Calcium (mg)', 'Notes']

// Use hardcoded data (from spec)
const recipesData = [
  { Recipe: "Kiley's carrot cake v4", Servings: '16 slices', Calories: 178, 'Protein (g)': 20, 'Calcium (mg)': 140, Notes: 'Whey, oat flour, Greek yogurt...' },
  { Recipe: "Kiley's banana cake healing version", Servings: '16 slices', Calories: 160, 'Protein (g)': 7, 'Calcium (mg)': 65, Notes: 'Similar base to carrot cake' },
  { Recipe: "Kiley's raisin bread", Servings: '10 slices', Calories: 150, 'Protein (g)': 9, 'Calcium (mg)': 53, Notes: '1 scoop whey, 2 cups oats, 1/2 cup raisins...' },
  { Recipe: 'High-protein whole wheat bagels', Servings: '6 bagels', Calories: 220, 'Protein (g)': 14, 'Calcium (mg)': 200, Notes: '2 cups whole wheat flour, 2 cups Greek yogurt, 1 egg' },
  { Recipe: 'Cream cheese cottage cheese frosting', Servings: '~24 tbsp', Calories: 21, 'Protein (g)': 1.4, 'Calcium (mg)': 10, Notes: '1 cup cottage cheese, 1/2 cup whipped cream cheese' },
]

let recipesRows
const recipesSheet = wb.Sheets['Recipes']
if (recipesSheet) {
  try {
    const sheetRows = XLSX.utils.sheet_to_json(recipesSheet, { defval: '' })
    recipesRows = sheetRows.map(r => [
      String(r['Recipe'] ?? ''),
      String(r['Servings'] ?? ''),
      String(r['Per Serving: Calories'] ?? r['Calories'] ?? ''),
      String(r['Per Serving: Protein (g)'] ?? r['Protein (g)'] ?? ''),
      String(r['Per Serving: Calcium (mg)'] ?? r['Calcium (mg)'] ?? ''),
      String(r['Notes'] ?? ''),
    ]).filter(r => r[0])
  } catch (e) {
    recipesRows = null
  }
}
if (!recipesRows || recipesRows.length === 0) {
  recipesRows = recipesData.map(r => [
    r.Recipe, r.Servings, String(r.Calories), String(r['Protein (g)']), String(r['Calcium (mg)']), r.Notes,
  ])
}

const recipesContent = `# Recipes\n\nPer-serving nutrition for homemade items.\n\n${serializeTable(RECIPE_HEADERS, recipesRows)}\n`
fs.writeFileSync(path.join(outFolder, 'recipes.md'), recipesContent, 'utf8')
console.log(`Wrote recipes.md (${recipesRows.length} rows)`)

console.log(`\nDone! Files written to: ${outFolder}`)
