import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { BRAND } from './branding.js'
import {
  InstallButton, InstallModal, InstallNudge, InstallSuccessToast,
} from '../packages/install-prompt/src/index.js'
import '../packages/install-prompt/src/styles/install-prompt.css'
import { storage, getEngine, initStorage, detectModeFromData, registerSyncWorker, PROVIDERS, getProviderName, getAvailableProviders, getPrimaryId, setPrimary } from './storage/storage.js'
import {
  DAILY_LOG_HEADERS, GOALS_HEADERS, RECIPE_HEADERS, WEIGHT_HEADERS,
} from './storage/markdown.js'
import { readEntries, writeEntries } from './storage/mdyaml.js'
import { currentMonthKey, entryFileName, listMonthFiles, groupByMonth } from './storage/monthly.js'
import { mergeEntry, updateEntryAt } from './storage/mergeEntry.js'
import {
  SUGGESTIONS_FILE,
  parseSuggestions,
  serializeSuggestions,
  upsertSuggestion,
  expandWithHalves,
  expandRecipeServings,
} from './storage/suggestions.js'
import * as llm from './llm.js'
import * as openrouterAuth from './openrouter-auth.js'
import SimpleMode from './SimpleMode.jsx'
import { StatusBadge } from './StatusBadge.jsx'
import { NutritionSettings } from './NutritionSettings.jsx'
import { UpsellModal } from './UpsellModal.jsx'
import { Footer } from './Footer.jsx'
import { CoachingCard, useCoaching } from './Coaching.jsx'
import { debounce } from './debounce.js'
import AutocompleteInput from './AutocompleteInput.jsx'

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'log', label: 'Log' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'goals', label: 'Goals' },
]

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack']

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function num(v) {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Water keyword matching — edit this list to control what counts as water.
// Matching is case-insensitive substring. The LLM is NOT used for water.
// ---------------------------------------------------------------------------
export const WATER_KEYWORDS = [
  'water',
  'sparkling water',
  'mineral water',
  'seltzer',
  'club soda',
  'herbal tea',
  'chamomile',
  'peppermint tea',
  'rooibos',
  'hibiscus tea',
  'tisane',
]

const WATER_UNIT_RE = '(?:fl\\.?\\s*oz|ounces?|oz|ml|milliliters?|litres?|liters?|l\\b|cups?|glasses?|bottles?|cans?)'

function ozFromQtyUnit(qtyStr, unitRaw) {
  const qty = parseFloat(qtyStr)
  const unit = unitRaw.replace(/\s+/g, '').toLowerCase()
  if (/^(fl\.?oz|ounces?|oz)/.test(unit)) return Math.round(qty / 2) * 2
  if (/^ml|^milliliter/.test(unit)) return Math.round(qty / 29.5 / 2) * 2
  if (unit === 'l' || /^lit(re|er)s?$/.test(unit)) return Math.round(qty * 33.8 / 2) * 2
  if (/^cups?|^glasses?/.test(unit)) return qty * 8
  if (/^bottles?/.test(unit)) return qty * 16
  if (/^cans?/.test(unit)) return qty * 12
  return 0
}

function waterQtyOzList(str) {
  const re = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + WATER_UNIT_RE + ')', 'gi')
  const out = []
  let m
  while ((m = re.exec(str)) !== null) out.push(ozFromQtyUnit(m[1], m[2]))
  return out
}

// Detect total water (oz) in a description. Each water keyword mention is
// matched to the quantity nearest to it (preferring the one immediately
// before, then after) so non-water amounts like "1/2 cup milk" aren't counted,
// and multiple mentions (e.g. "20 oz water, 20 oz water") are summed.
export function detectWaterOz(description) {
  if (!description) return 0
  const lower = description.toLowerCase()

  // Longest keywords first so "sparkling water" isn't also matched as "water".
  const kw = [...WATER_KEYWORDS]
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const kwRe = new RegExp('(?:' + kw + ')', 'g')

  let total = 0
  let found = false
  let m
  while ((m = kwRe.exec(lower)) !== null) {
    found = true
    const idx = m.index
    const before = lower.slice(Math.max(0, idx - 24), idx)
    const beforeList = waterQtyOzList(before)
    let oz = beforeList.length ? beforeList[beforeList.length - 1] : null
    if (oz == null) {
      const after = lower.slice(idx + m[0].length, idx + m[0].length + 24)
      const afterList = waterQtyOzList(after)
      oz = afterList.length ? afterList[0] : null
    }
    total += (oz == null ? 8 : oz)
  }

  if (!found) return 0
  return Math.round(total * 2) / 2
}

// Parse a goal target string like "1400-1600 kcal" or "90-120 g" → midpoint number
function parseGoalTarget(target) {
  if (!target) return null
  const m = String(target).match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/)
  if (!m) return null
  const lo = Number(m[1])
  const hi = m[2] ? Number(m[2]) : lo
  return { lo, hi, mid: (lo + hi) / 2 }
}

function progressClass(actual, goal) {
  if (!goal) return 'good'
  const ratio = actual / goal.mid
  if (ratio >= 0.9) return 'good'
  if (ratio >= 0.6) return 'warn'
  return 'bad'
}

export default function App() {
  const [storageReady, setStorageReady] = useState(false)
  const [storageProvider, setStorageProvider] = useState('')
  const [folderName, setFolderName] = useState('')
  const [tab, setTab] = useState('today')
  const [installOpen, setInstallOpen] = useState(false)
  const [logEntries, setLogEntries] = useState([])
  const [goals, setGoals] = useState([])
  const [recipes, setRecipes] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [weightEntries, setWeightEntries] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // Mode state — respect explicit user choice; auto-detect from data on first load.
  const MODE_KEY = 'mealjot-mode'
  const [mode, setModeState] = useState(() => localStorage.getItem(MODE_KEY) || '')
  const switchMode = (m) => {
    localStorage.setItem(MODE_KEY, m)
    setModeState(m)
  }
  // Resolved mode: explicit choice wins; fallback to 'advanced' until detection runs.
  const resolvedMode = mode || 'advanced'
  const [orConnectedBanner, setOrConnectedBanner] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', providers: {} })

  const handleStorageReady = async (providerId) => {
    setStorageProvider(providerId)
    setStorageReady(true)
    try {
      const name = await storage.getFolderName()
      setFolderName(name)
    } catch (e) {
      setError(`Failed to get folder name: ${e.message}`)
    }
  }

  // Handle OpenRouter OAuth callback on page load
  useEffect(() => {
    (async () => {
      try {
        const handled = await openrouterAuth.handleCallback()
        if (handled) {
          llm.setProvider('openrouter')
          setOrConnectedBanner(true)
          setTimeout(() => setOrConnectedBanner(false), 5000)
        }
      } catch (e) {
        console.error('OpenRouter callback error:', e)
      }
    })()
  }, [])

  // Initialize storage on load — default to localStorage, or restore saved provider
  useEffect(() => {
    (async () => {
      try {
        await registerSyncWorker()
        await initStorage()
        await handleStorageReady(getPrimaryId())
        // Auto-detect mode from data only when user hasn't explicitly chosen.
        if (!localStorage.getItem(MODE_KEY)) {
          const detected = await detectModeFromData()
          if (detected) switchMode(detected)
        }
      } catch (e) {
        setError(`Storage init failed: ${e.message}`)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const loadAll = useCallback(async () => {
    if (!storageReady) return
    try {
      const curKey = currentMonthKey()
      const curName = entryFileName('entries', curKey)
      const [curText, goalsText, recipesText, suggestionsText, weightText] = await Promise.all([
        storage.readFile(curName),
        storage.readFile('goals.md'),
        storage.readFile('recipes.md'),
        storage.readFile(SUGGESTIONS_FILE),
        storage.readFile('weight.md'),
      ])
      setLogEntries(readEntries(curText, DAILY_LOG_HEADERS).rows)
      setGoals(readEntries(goalsText, GOALS_HEADERS).rows)
      const recipeRows = readEntries(recipesText, RECIPE_HEADERS).rows
      setRecipes(recipeRows)
      setSuggestions(parseSuggestions(suggestionsText || ''))
      setWeightEntries(readEntries(weightText, WEIGHT_HEADERS).rows)
      setError('')

      // Lazy-load history in the background (for LogView).
      setLoadingHistory(true)
      const months = await listMonthFiles(storage, 'entries')
      const rest = months.filter(m => m.monthKey !== curKey)
      if (rest.length) {
        const texts = await Promise.all(rest.map(m => storage.readFile(m.name)))
        const histRows = texts.flatMap(t => readEntries(t, DAILY_LOG_HEADERS).rows)
        setLogEntries(prev => {
          const merged = [...prev, ...histRows]
          merged.sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0))
          return merged
        })
      }
      setLoadingHistory(false)
    } catch (e) {
      setError(`Load error: ${e.message}`)
      setLoadingHistory(false)
    }
  }, [storageReady, resolvedMode])

  useEffect(() => { 
    if (storageReady) {
      loadAll()
      setLoading(false)
      // Subscribe to sync engine status + reload on remote updates.
      // Debounced because the engine fires one `lastRemoteUpdate` per file —
      // a sync that pulls down N files would otherwise trigger N reloads.
      const debouncedReload = debounce(() => loadAll(), 150)
      try {
        const eng = getEngine()
        const unsub = eng.subscribe((s) => {
          setSyncStatus(s)
          if (s.lastRemoteUpdate) debouncedReload()
        })
        return () => {
          debouncedReload.cancel()
          unsub()
        }
      } catch { /* engine not ready */ }
    }
  }, [storageReady, loadAll])

  const saveLog = async (newEntries) => {
    const sorted = [...newEntries].sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0))
    const buckets = groupByMonth(sorted)
    const existing = await listMonthFiles(storage, 'entries')
    // Empty out months that previously had entries but no longer do.
    for (const m of existing) {
      if (!buckets.has(m.monthKey)) {
        const orig = await storage.readFile(m.name)
        await storage.writeFile(m.name, writeEntries(orig, DAILY_LOG_HEADERS, [], { kind: 'entries', mode: 'advanced', period: m.monthKey }))
      }
    }
    for (const [key, rows] of buckets) {
      const name = entryFileName('entries', key)
      const original = await storage.readFile(name)
      const next = writeEntries(original, DAILY_LOG_HEADERS, rows, { kind: 'entries', mode: 'advanced', period: key })
      await storage.writeFile(name, next)
    }
    setLogEntries(sorted)
  }

  const saveRecipes = async (newRecipes) => {
    const original = await storage.readFile('recipes.md')
    const next = writeEntries(original, RECIPE_HEADERS, newRecipes, { kind: 'recipes' })
    await storage.writeFile('recipes.md', next)
    setRecipes(newRecipes)
  }

  const saveWeight = async (entry) => {
    const original = await storage.readFile('weight.md')
    const rows = readEntries(original, WEIGHT_HEADERS).rows
    // Upsert: replace existing entry for same date, otherwise append
    const idx = rows.findIndex(r => r.Date === entry.Date)
    const newRows = idx >= 0
      ? [...rows.slice(0, idx), entry, ...rows.slice(idx + 1)]
      : [...rows, entry]
    newRows.sort((a, b) => a.Date.localeCompare(b.Date))
    const next = writeEntries(original, WEIGHT_HEADERS, newRows, { kind: 'weight' })
    await storage.writeFile('weight.md', next)
    setWeightEntries(newRows)
  }

  const addEntries = async (newEntries) => {
    // 1. Update log (merging items that share Date+Meal)
    let nextLog = logEntries
    for (const e of newEntries) {
      nextLog = mergeEntry(nextLog, e, 'advanced')
    }
    await saveLog(nextLog)

    // 2. Update suggestions (tracking each item individually)
    let nextSuggestions = suggestions
    for (const e of newEntries) {
      if (e?.['Food Description']) {
        nextSuggestions = upsertSuggestion(nextSuggestions, {
          name: e['Food Description'],
          protein_g: e['Protein (g)'],
          calories: e.Calories,
          calcium_mg: e['Calcium (mg)'],
          veg_servings: e['Veg Servings'],
          omega3: e['Omega-3'],
        })
      }
    }
    setSuggestions(nextSuggestions)
    try {
      await storage.writeFile(SUGGESTIONS_FILE, serializeSuggestions(nextSuggestions))
    } catch (e) {
      console.warn('Failed to persist suggestions.csv:', e)
    }
  }

  const updateEntry = async (idx, entry) => {
    await saveLog(updateEntryAt(logEntries, idx, entry))
  }

  const deleteEntry = async (idx) => {
    await saveLog(logEntries.filter((_, i) => i !== idx))
  }

  // Coaching — shared with SimpleMode, shown in Advanced too.
  const proteinGoalRow = goals.find(g => /protein/i.test(g.Nutrient || g['Nutrient / Metric'] || ''))
  const proteinGoal = proteinGoalRow ? (parseGoalTarget(proteinGoalRow.Target)?.mid ?? 100) : 100
  const { coaching, setCoaching, requestCoaching } = useCoaching({
    storageReady,
    entries: logEntries,
    proteinGoal,
    today: todayStr(),
    goals,
    frequentFoods: suggestions,
  })

  const addEntriesWithCoaching = async (newEntries) => {
    await addEntries(newEntries)
    if (newEntries.length === 0) return
    const entry = newEntries[0]
    // Pass all entries for this meal so coaching reflects the full session
    const sameMeal = logEntries.filter(
      e => e.Date === entry.Date && e.Meal === entry.Meal
    )
    const totalProtein = newEntries.reduce((sum, e) => sum + num(e['Protein (g)']), 0)
    requestCoaching(entry.Meal || '', totalProtein, [...sameMeal, ...newEntries])
  }

  if (loading) return <div className="app"><div className="empty">Loading…</div></div>

  if (!storageReady) {
    return <div className="app"><div className="empty">Initializing storage…</div></div>
  }

  if (resolvedMode === 'simple') {
    return <SimpleMode storageReady={storageReady} folderName={folderName} mode={resolvedMode} setMode={switchMode} storageProvider={storageProvider} syncStatus={syncStatus} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          {BRAND.emoji} {BRAND.appName}
        </h1>
        <StatusBadge
          folderName={folderName}
          syncStatus={syncStatus}
          mode={resolvedMode}
          setMode={switchMode}
          storageProvider={storageProvider}
        />
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <div className="banner error">{error}</div>}
      {loadingHistory && <div className="banner">Loading history…</div>}
      {orConnectedBanner && (
        <div className="banner" style={{ background: 'var(--good)', color: '#fff' }}>
          ✅ OpenRouter connected! You can now estimate nutrition using GPT-4o-mini and 400+ other models.
        </div>
      )}

      {/* Coaching tip — shown on load if LLM connected, refreshed after each save */}
      <CoachingCard text={coaching} onDismiss={() => setCoaching(null)} />

      {tab === 'today' && <TodayView entries={logEntries} goals={goals} onAdd={addEntriesWithCoaching} onUpdate={updateEntry} onDelete={deleteEntry} recipes={recipes} suggestions={suggestions} weightEntries={weightEntries} onLogWeight={saveWeight} />}
      {tab === 'log' && <LogView entries={logEntries} onDelete={deleteEntry} onUpdate={updateEntry} />}
      {tab === 'recipes' && <RecipesView recipes={recipes} onSave={saveRecipes} />}
      {tab === 'goals' && <GoalsView goals={goals} />}
      <InstallNudge onOpen={() => setInstallOpen(true)} appName={BRAND.appName} />
      <InstallSuccessToast appName={BRAND.appName} />
      {installOpen && <InstallModal onClose={() => setInstallOpen(false)} appName={BRAND.appName} />}
      <Footer
        installButton={
          <InstallButton
            onOpen={() => setInstallOpen(true)}
            appName={BRAND.appName}
            label="Install app"
          />
        }
      />
    </div>
  )
}

function WeightRow({ weightEntries, onLog, today }) {
  const sorted = [...(weightEntries || [])].sort((a, b) => b.Date.localeCompare(a.Date))
  const todayEntry = sorted.find(e => e.Date === today)
  const prevEntry = sorted.find(e => e.Date < today)

  const [val, setVal] = useState('')
  const [unit, setUnit] = useState(() => sorted[0]?.Unit || 'kg')
  const [editing, setEditing] = useState(false)

  const diff = todayEntry && prevEntry
    ? +(parseFloat(todayEntry.Weight) - parseFloat(prevEntry.Weight)).toFixed(1)
    : null

  const handleLog = () => {
    if (!val.trim()) return
    onLog({ Date: today, Weight: val.trim(), Unit: unit, Notes: '' })
    setVal('')
    setEditing(false)
  }

  const showInput = !todayEntry || editing

  return (
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 14 }}>
      <span style={{ width: 110, color: 'var(--text-muted)', fontWeight: 500, flexShrink: 0 }}>Weight</span>

      {!showInput ? (
        <>
          <span style={{ fontWeight: 600 }}>{todayEntry.Weight} {todayEntry.Unit}</span>
          {diff !== null && (
            <span style={{
              fontSize: 13, fontWeight: 500,
              color: diff > 0 ? 'var(--warn)' : diff < 0 ? 'var(--good)' : 'var(--text-muted)',
            }}>
              {diff > 0 ? `↑ ${diff}` : diff < 0 ? `↓ ${Math.abs(diff)}` : '→'}{' '}
              {diff !== 0 ? todayEntry.Unit : 'no change'}
            </span>
          )}
          <button
            className="icon-btn"
            onClick={() => { setVal(todayEntry.Weight); setUnit(todayEntry.Unit || 'kg'); setEditing(true) }}
            title="Update today's weight"
            style={{ fontSize: 12, marginLeft: 2 }}
          >✏️</button>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
          {!todayEntry && prevEntry && (
            <span style={{ color: 'var(--text-muted)', fontSize: 12, marginRight: 4 }}>
              Last: {prevEntry.Weight} {prevEntry.Unit}
            </span>
          )}
          <input
            type="number"
            step="0.1"
            min="0"
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLog()}
            placeholder="0.0"
            style={{ width: 72, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
          />
          <select
            value={unit}
            onChange={e => setUnit(e.target.value)}
            style={{ padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--card)', color: 'inherit' }}
          >
            <option>kg</option>
            <option>lbs</option>
          </select>
          <button className="btn btn-secondary" onClick={handleLog} disabled={!val.trim()} style={{ padding: '4px 10px', fontSize: 13 }}>
            Log
          </button>
          {editing && (
            <button className="btn btn-secondary" onClick={() => setEditing(false)} style={{ padding: '4px 10px', fontSize: 13 }}>
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function TodayView({ entries, goals, onAdd, onUpdate, onDelete, recipes, suggestions, weightEntries, onLogWeight }) {
  const today = todayStr()
  const todays = entries.filter(e => e.Date === today)

  const totals = todays.reduce((acc, e) => ({
    calories: acc.calories + num(e.Calories),
    protein: acc.protein + num(e['Protein (g)']),
    calcium: acc.calcium + num(e['Calcium (mg)']),
    veg: acc.veg + num(e['Veg Servings']),
    water: Math.round((acc.water + num(e['Water (oz)'])) * 2) / 2,
    omega3: acc.omega3 || e['Omega-3'] === 'Y',
  }), { calories: 0, protein: 0, calcium: 0, veg: 0, water: 0, omega3: false })

  const goalMap = Object.fromEntries(goals.map(g => [g.Nutrient, parseGoalTarget(g.Target)]))

  const rows = [
    { label: 'Calories', value: totals.calories, unit: 'kcal', goal: goalMap.Calories },
    { label: 'Protein', value: totals.protein, unit: 'g', goal: goalMap.Protein },
    { label: 'Calcium', value: totals.calcium, unit: 'mg', goal: goalMap.Calcium },
    { label: 'Vegetables', value: totals.veg, unit: 'srv', goal: goalMap.Vegetables },
    { label: 'Water', value: totals.water, unit: 'oz', goal: goals.reduce((found, g) => found || (/^(water|hydration)$/i.test((g.Nutrient || '').trim()) ? parseGoalTarget(g.Target) : null), null) },
  ]

  return (
    <>
      <div className="card">
        <h2>Today's Progress</h2>
        {rows.map(r => {
          const pct = r.goal ? Math.min(100, Math.round((r.value / r.goal.hi) * 100)) : 0
          return (
            <div key={r.label} className="progress-row">
              <span className="label">{r.label}</span>
              <div className="progress-bar">
                <div className={`progress-fill ${progressClass(r.value, r.goal)}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="value">
                {Math.round(r.value)}{r.goal ? ` / ${r.goal.hi}` : ''} {r.unit}
              </span>
            </div>
          )
        })}
        <div className="muted" style={{ marginTop: 8 }}>
          Omega-3 today: <strong style={{ color: totals.omega3 ? 'var(--good)' : 'var(--bad)' }}>{totals.omega3 ? '✓ Yes' : '✗ Not yet'}</strong>
        </div>
        <WeightRow weightEntries={weightEntries} onLog={onLogWeight} today={today} />
      </div>

      <AddEntry onAdd={onAdd} recipes={recipes} defaultDate={today} suggestions={suggestions} />

      <div className="card">
        <h2>Today's Entries ({todays.length})</h2>
        {todays.length === 0 ? (
          <div className="empty">Nothing logged yet today.</div>
        ) : todays.map((e) => {
          const globalIdx = entries.indexOf(e)
          return (
            <EntryRow
              key={globalIdx}
              entry={e}
              onUpdate={(updated) => onUpdate(globalIdx, updated)}
              onDelete={() => onDelete(globalIdx)}
            />
          )
        })}
      </div>
    </>
  )
}

function PreviewItem({ item, onChange, onRemove, onAdd }) {
  const [editing, setEditing] = useState(false)

  // If user starts editing a loading item, it should stop loading
  // so a late LLM response doesn't overwrite their manual input.
  const handleStartEdit = () => {
    if (!editing) {
      if (item.loading) onChange('loading', false)
      setEditing(true)
    } else {
      setEditing(false)
    }
  }

  return (
    <div className="preview-item">
      <div className="preview-item-header">
        {editing ? (
          <input
            value={item.name}
            onChange={e => onChange('name', e.target.value)}
            className="preview-item-name-input"
          />
        ) : (
          <strong style={{ fontSize: 14 }}>{item.name}</strong>
        )}
        <div className="flex items-center gap-8">
          {item.loading ? <span className="spinner" /> : (
            <span className={`muted confidence-${item.confidence}`} style={{ fontSize: 10 }}>
              {item.confidence}
            </span>
          )}
          <button className="icon-btn" onClick={handleStartEdit} title={editing ? 'Done' : 'Edit name'} style={{ minHeight: 0, minWidth: 0, padding: 4 }}>
            {editing ? '✅' : '✏️'}
          </button>
          <button className="icon-btn" onClick={onAdd} title="Save this item" style={{ minHeight: 0, minWidth: 0, padding: 4 }}>➕</button>
          <button className="icon-btn" onClick={onRemove} title="Remove" style={{ minHeight: 0, minWidth: 0, padding: 4 }}>🗑</button>
        </div>
      </div>

      {item.err && <div className="banner error" style={{ padding: '4px 8px', fontSize: 12, marginBottom: 8 }}>{item.err}</div>}

      <div className="stat-grid" style={{ opacity: item.loading ? 0.5 : 1 }}>
        {editing ? (
          <>
            <NumStat label="kcal" value={item.calories} onChange={v => onChange('calories', v)} />
            <NumStat label="pro g" value={item.protein_g} onChange={v => onChange('protein_g', v)} />
            <NumStat label="Ca mg" value={item.calcium_mg} onChange={v => onChange('calcium_mg', v)} />
            <NumStat label="veg srv" value={item.veg_servings} step="0.5" onChange={v => onChange('veg_servings', v)} />
            <NumStat label="water oz" value={item.water_oz} step="2" onChange={v => onChange('water_oz', v)} />
            <div className="stat">
              <select value={item.omega3} onChange={e => onChange('omega3', e.target.value)} style={{ width: '100%', textAlign: 'center', border: 'none', background: 'transparent', fontSize: 14, fontWeight: 700 }}>
                <option value="Y">Y</option>
                <option value="N">N</option>
              </select>
              <div className="l">omega-3</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat"><div className="v">{item.calories}</div><div className="l">kcal</div></div>
            <div className="stat"><div className="v">{item.protein_g}</div><div className="l">pro g</div></div>
            <div className="stat"><div className="v">{item.calcium_mg}</div><div className="l">Ca mg</div></div>
            <div className="stat"><div className="v">{item.veg_servings}</div><div className="l">veg srv</div></div>
            <div className="stat"><div className="v">{item.water_oz}</div><div className="l">water</div></div>
            <div className="stat"><div className="v">{item.omega3}</div><div className="l">omega-3</div></div>
          </>
        )}
      </div>
    </div>
  )
}

function AddEntry({ onAdd, recipes, defaultDate, suggestions: suggestionsCsv = [] }) {
  const [date, setDate] = useState(defaultDate)
  const [meal, setMeal] = useState('Breakfast')
  const [desc, setDesc] = useState('')
  const [previews, setPreviews] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const abortControllerRef = useRef(null)

  useEffect(() => { setDate(defaultDate) }, [defaultDate])

  // Suggestions = recipes (as ½ / 1 / 2 serving variants) + suggestions.csv
  // (non-recipe items with a "Half X" virtual entry for each).
  const suggestions = useMemo(() => {
    const toItem = s => ({
      name: s.name,
      protein: num(s.protein_g),
      calories: num(s.calories),
      calcium_mg: num(s.calcium_mg),
      veg_servings: num(s.veg_servings),
      omega3: s.omega3 || 'N',
    })

    // Recipes → ½ serving, 1 serving, 2 servings
    const recipeItems = expandRecipeServings(recipes).map(toItem)

    // CSV items that aren't already covered by a recipe → expand with halves
    const recipeNames = new Set(recipes.map(r => (r.Recipe || '').trim().toLowerCase()))
    const nonRecipeCsv = suggestionsCsv.filter(
      s => !recipeNames.has((s.name || '').trim().toLowerCase())
    )
    const csvItems = expandWithHalves(nonRecipeCsv).map(toItem)

    return [...recipeItems, ...csvItems]
  }, [recipes, suggestionsCsv])

  const selectSuggestion = (s) => {
    setDesc(s.name)
    setPreviews([{
      id: Math.random().toString(36).slice(2),
      name: s.name,
      calories: s.calories,
      protein_g: s.protein,
      calcium_mg: s.calcium_mg,
      veg_servings: s.veg_servings,
      water_oz: detectWaterOz(s.name),
      omega3: s.omega3 || 'N',
      confidence: 'high',
      loading: false,
    }])
  }

  const estimate = async () => {
    if (!desc.trim()) return
    let parts = desc.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.length === 1 && parts[0].includes(' and ')) {
      parts = parts[0].split(/\s+and\s+/i).map(p => p.trim()).filter(Boolean)
    }
    if (parts.length === 0) return

    // Cancel any previous estimation
    if (abortControllerRef.current) abortControllerRef.current.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setBusy(true)
    setErr('')

    const isLlmReady = llm.isReady()
    const newPreviews = parts.map(name => ({
      id: Math.random().toString(36).slice(2),
      name,
      loading: isLlmReady,
      calories: 0,
      protein_g: 0,
      calcium_mg: 0,
      veg_servings: 0,
      water_oz: detectWaterOz(name),
      omega3: 'N',
      confidence: 'medium',
    }))
    setPreviews(newPreviews)

    if (!isLlmReady) {
      setErr('LLM_NOT_CONFIGURED')
      setBusy(false)
      return
    }

    // Parallel estimates
    try {
      await Promise.all(parts.map(async (part, i) => {
        try {
          const result = await llm.estimateNutrition(part, { recipes, signal: controller.signal })
          result.water_oz = detectWaterOz(part)
          setPreviews(prev => prev.map(p => (p.id === newPreviews[i].id && p.loading) ? { ...p, ...result, loading: false } : p))
        } catch (e) {
          if (e.name === 'AbortError') return
          setPreviews(prev => prev.map(p => (p.id === newPreviews[i].id && p.loading) ? { ...p, loading: false, err: e.message } : p))
          if (e.code === 'LLM_NOT_CONFIGURED') setErr('LLM_NOT_CONFIGURED')
        }
      }))
    } finally {
      // Only clear busy if this run wasn't superseded/aborted. A newer
      // estimate (or save/discard) will manage the busy flag itself.
      if (!controller.signal.aborted) {
        setBusy(false)
      }
    }
  }

  const save = async () => {
    // Cancel any pending estimation. Since the aborted estimate's finally
    // block won't reset busy, we do it here.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setBusy(false)
    }
    if (previews.length === 0) return
    const newEntries = previews.map(p => ({
      Date: date,
      Meal: meal,
      'Food Description': p.name.trim(),
      Calories: p.calories,
      'Protein (g)': p.protein_g,
      'Calcium (mg)': p.calcium_mg,
      'Veg Servings': p.veg_servings,
      'Water (oz)': p.water_oz,
      'Omega-3': p.omega3,
      Notes: '',
    }))
    await onAdd(newEntries)
    setDesc(''); setPreviews([]); setErr('')
  }

  const updatePreview = (id, key, val) => {
    setPreviews(prev => prev.map(p => p.id === id ? { ...p, [key]: val, loading: false, err: undefined } : p))
  }

  const removePreview = (id) => {
    setPreviews(prev => prev.filter(p => p.id !== id))
  }

  const totals = previews.reduce((acc, p) => ({
    calories: acc.calories + num(p.calories),
    protein_g: acc.protein_g + num(p.protein_g),
    calcium_mg: acc.calcium_mg + num(p.calcium_mg),
    veg_servings: acc.veg_servings + num(p.veg_servings),
    water_oz: Math.round((acc.water_oz + num(p.water_oz)) * 2) / 2,
    omega3: acc.omega3 || p.omega3 === 'Y',
  }), { calories: 0, protein_g: 0, calcium_mg: 0, veg_servings: 0, water_oz: 0, omega3: false })

  return (
    <div className="card">
      <h2>Log a meal</h2>
      <div className="row">
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Meal</label>
          <select value={meal} onChange={e => setMeal(e.target.value)}>
            {MEALS.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Food description</label>
        <AutocompleteInput
          value={desc}
          onChange={setDesc}
          suggestions={suggestions}
          onSelect={selectSuggestion}
          placeholder="e.g. 2 eggs, 1/2 avocado toast, 1 cup Greek yogurt with walnuts"
          rows={3}
        />
      </div>

      <UpsellModal isOpen={err === 'LLM_NOT_CONFIGURED'} onClose={() => setErr('')} />
      {err && err !== 'LLM_NOT_CONFIGURED' && <div className="banner error">{err}</div>}

      {previews.length === 0 && (
        <button className="btn" onClick={estimate} disabled={busy || !desc.trim()}>
          {busy ? <><span className="spinner" />Estimating…</> : '✨ Estimate nutrition'}
        </button>
      )}

      {previews.length > 0 && (
        <div className="previews-container">
           <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
             <strong>Estimated items</strong>
             {busy && <span className="spinner" />}
           </div>

           {previews.map(p => (
             <PreviewItem
               key={p.id}
               item={p}
               onChange={(key, val) => updatePreview(p.id, key, val)}
               onRemove={() => removePreview(p.id)}
               onAdd={() => {
                 // Note: don't abort the in-flight batch. Saving one item
                 // shouldn't cancel estimates for the others; the per-item
                 // `loading` check in the setPreviews updater ensures the
                 // removed item is ignored if its response lands late.
                 onAdd([{
                   Date: date,
                   Meal: meal,
                   'Food Description': p.name.trim(),
                   Calories: p.calories,
                   'Protein (g)': p.protein_g,
                   'Calcium (mg)': p.calcium_mg,
                   'Veg Servings': p.veg_servings,
                   'Water (oz)': p.water_oz,
                   'Omega-3': p.omega3,
                   Notes: '',
                 }])
                 removePreview(p.id)
               }}
             />
           ))}

           <div className="preview-card" style={{ background: 'white', border: '1px solid var(--border)', margin: '12px 0 0' }}>
             <div className="flex justify-between items-center">
               <strong>Total</strong>
             </div>
             <div className="stat-grid">
                <div className="stat"><div className="v">{totals.calories}</div><div className="l">kcal</div></div>
                <div className="stat"><div className="v">{totals.protein_g}</div><div className="l">pro g</div></div>
                <div className="stat"><div className="v">{totals.calcium_mg}</div><div className="l">Ca mg</div></div>
                <div className="stat"><div className="v">{totals.veg_servings}</div><div className="l">veg srv</div></div>
                <div className="stat"><div className="v">{totals.water_oz}</div><div className="l">water</div></div>
                <div className="stat"><div className="v">{totals.omega3 ? 'Y' : 'N'}</div><div className="l">omega-3</div></div>
             </div>
             <div className="flex gap-8" style={{ marginTop: 12 }}>
                <button className="btn" onClick={save} disabled={previews.length === 0}>Save all</button>
                <button className="btn btn-secondary" onClick={() => {
                  if (abortControllerRef.current) {
                    abortControllerRef.current.abort()
                    setBusy(false)
                  }
                  setPreviews([])
                }}>Discard all</button>
             </div>
           </div>
        </div>
      )}
    </div>
  )
}

function NumStat({ label, value, onChange, step = '1' }) {
  return (
    <div className="stat">
      <input
        type="number"
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', textAlign: 'center', border: 'none', background: 'transparent', fontSize: 16, fontWeight: 700 }}
      />
      <div className="l">{label}</div>
    </div>
  )
}

function EntryRow({ entry, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry)

  if (editing) {
    const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
    const save = async () => { await onUpdate(draft); setEditing(false) }
    const cancel = () => { setDraft(entry); setEditing(false) }
    return (
      <div className="entry" style={{ background: 'rgba(0,0,0,0.03)' }}>
        <div className="entry-header">
          <select value={draft.Meal || ''} onChange={e => set('Meal', e.target.value)}>
            <option value="">—</option>
            {MEALS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="date" value={draft.Date || ''} onChange={e => set('Date', e.target.value)} />
        </div>
        <textarea
          rows={2}
          value={draft['Food Description'] || ''}
          onChange={e => set('Food Description', e.target.value)}
          style={{ width: '100%', marginTop: 6 }}
        />
        <div className="entry-stats" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          <label>kcal <input type="number" value={draft.Calories || 0} onChange={e => set('Calories', e.target.value)} style={{ width: 70 }} /></label>
          <label>protein <input type="number" value={draft['Protein (g)'] || 0} onChange={e => set('Protein (g)', e.target.value)} style={{ width: 60 }} /></label>
          <label>Ca <input type="number" value={draft['Calcium (mg)'] || 0} onChange={e => set('Calcium (mg)', e.target.value)} style={{ width: 60 }} /></label>
          <label>veg <input type="number" step="0.5" value={draft['Veg Servings'] || 0} onChange={e => set('Veg Servings', e.target.value)} style={{ width: 50 }} /></label>
          <label>water oz <input type="number" step="2" value={draft['Water (oz)'] || 0} onChange={e => set('Water (oz)', e.target.value)} style={{ width: 60 }} /></label>
          <label>ω-3 <input type="checkbox" checked={draft['Omega-3'] === 'Y'} onChange={e => set('Omega-3', e.target.checked ? 'Y' : '')} /></label>
        </div>
        <input
          placeholder="Notes"
          value={draft.Notes || ''}
          onChange={e => set('Notes', e.target.value)}
          style={{ width: '100%', marginTop: 6 }}
        />
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button className="btn" onClick={save}>Save</button>
          <button className="btn btn-secondary" onClick={cancel}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="entry">
      <div className="entry-header">
        <span><strong>{entry.Meal || '—'}</strong></span>
        <span>
          {entry.Date}
          {onUpdate && <button className="icon-btn" title="Edit" onClick={() => setEditing(true)} style={{ marginLeft: 8 }}>✏️</button>}
          {onDelete && <button className="icon-btn" title="Delete" onClick={onDelete} style={{ marginLeft: 4 }}>🗑</button>}
        </span>
      </div>
      <div className="entry-desc">{entry['Food Description']}</div>
      <div className="entry-stats">
        <span><strong>{entry.Calories || 0}</strong> kcal</span>
        <span><strong>{entry['Protein (g)'] || 0}</strong>g protein</span>
        <span><strong>{entry['Calcium (mg)'] || 0}</strong>mg Ca</span>
        <span><strong>{entry['Veg Servings'] || 0}</strong> veg</span>
        {num(entry['Water (oz)']) > 0 && <span><strong>{entry['Water (oz)']}</strong>oz water</span>}
        {entry['Omega-3'] === 'Y' && <span style={{ color: 'var(--good)' }}>ω-3</span>}
      </div>
    </div>
  )
}

function LogView({ entries, onDelete, onUpdate }) {
  // Group by date
  const byDate = {}
  for (const e of entries) {
    if (!byDate[e.Date]) byDate[e.Date] = []
    byDate[e.Date].push(e)
  }
  const dates = Object.keys(byDate).sort().reverse()

  if (entries.length === 0) {
    return <div className="card"><div className="empty">No entries yet. Add a meal on the Today tab.</div></div>
  }

  return (
    <div className="card">
      <h2>All Entries ({entries.length})</h2>
      {dates.map(date => {
        const dayEntries = byDate[date]
        const totals = dayEntries.reduce((a, e) => ({
          cal: a.cal + num(e.Calories),
          pro: a.pro + num(e['Protein (g)']),
          ca: a.ca + num(e['Calcium (mg)']),
          veg: a.veg + num(e['Veg Servings']),
          water: Math.round((a.water + num(e['Water (oz)'])) * 2) / 2,
        }), { cal: 0, pro: 0, ca: 0, veg: 0, water: 0 })
        return (
          <div key={date} className="day-section">
            <div className="day-header">
              <h3>{date}</h3>
              <span className="day-totals">
                {Math.round(totals.cal)} kcal · {Math.round(totals.pro)}g pro · {Math.round(totals.ca)}mg Ca · {totals.veg} veg{totals.water > 0 ? ` · ${Math.round(totals.water)}oz water` : ''}
              </span>
            </div>
            {dayEntries.map((e, i) => {
              const globalIdx = entries.indexOf(e)
              return (
                <EntryRow
                  key={i}
                  entry={e}
                  onUpdate={onUpdate && ((updated) => onUpdate(globalIdx, updated))}
                  onDelete={() => onDelete(globalIdx)}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function RecipesView({ recipes, onSave }) {
  const [draft, setDraft] = useState({ Recipe: '', Servings: '', Calories: '', 'Protein (g)': '', 'Calcium (mg)': '', Notes: '' })

  const add = async () => {
    if (!draft.Recipe.trim()) return
    await onSave([...recipes, draft])
    setDraft({ Recipe: '', Servings: '', Calories: '', 'Protein (g)': '', 'Calcium (mg)': '', Notes: '' })
  }

  const remove = async (i) => {
    await onSave(recipes.filter((_, j) => j !== i))
  }

  return (
    <>
      <div className="card">
        <h2>Recipes ({recipes.length})</h2>
        <p className="muted">Enter the whole recipe's totals plus how many servings it makes — the app divides to get per-serving nutrition. Mention recipes by name when logging meals for accurate estimates.</p>
        {recipes.length === 0 ? (
          <div className="empty">No recipes yet.</div>
        ) : (
          <div className="recipes-table-wrap">
            <table className="simple recipes-table">
              <thead>
                <tr>{RECIPE_HEADERS.map(h => <th key={h}>{h}</th>)}<th></th></tr>
              </thead>
              <tbody>
                {recipes.map((r, i) => (
                  <tr key={i}>
                    {RECIPE_HEADERS.map(h => <td key={h}>{r[h]}</td>)}
                    <td><button className="icon-btn" onClick={() => remove(i)}>🗑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Add recipe</h3>
        <div className="row">
          <div className="field"><label>Name</label><input value={draft.Recipe} onChange={e => setDraft({ ...draft, Recipe: e.target.value })} /></div>
          <div className="field"><label>Servings</label><input value={draft.Servings} onChange={e => setDraft({ ...draft, Servings: e.target.value })} /></div>
        </div>
        <div className="row">
          <div className="field"><label>Calories</label><input type="number" value={draft.Calories} onChange={e => setDraft({ ...draft, Calories: e.target.value })} /></div>
          <div className="field"><label>Protein (g)</label><input type="number" value={draft['Protein (g)']} onChange={e => setDraft({ ...draft, 'Protein (g)': e.target.value })} /></div>
          <div className="field"><label>Calcium (mg)</label><input type="number" value={draft['Calcium (mg)']} onChange={e => setDraft({ ...draft, 'Calcium (mg)': e.target.value })} /></div>
        </div>
        <div className="field"><label>Notes</label><input value={draft.Notes} onChange={e => setDraft({ ...draft, Notes: e.target.value })} /></div>
        <button className="btn" onClick={add} disabled={!draft.Recipe.trim()}>Add recipe</button>
      </div>
    </>
  )
}

function GoalsView({ goals }) {
  return (
    <div className="card">
      <h2>Daily Goals</h2>
      <p className="muted">Edit <code>goals.md</code> in your folder to change targets.</p>
      <table className="simple">
        <thead><tr>{GOALS_HEADERS.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {goals.map((g, i) => (
            <tr key={i}>{GOALS_HEADERS.map(h => <td key={h}>{g[h]}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const STORAGE_META = {
  [PROVIDERS.LOCAL_STORAGE]: {
    tagline: 'Works everywhere, no setup',
    pros: ['No sign-in needed', 'Instant start'],
    cons: ['This browser only — won\'t sync to other devices'],
  },
  [PROVIDERS.FSA]: {
    tagline: 'Plain text files on your computer',
    pros: ['Files you own and can edit directly', 'Works offline', 'Survives browser resets'],
    cons: ['Chrome or Edge desktop only'],
  },
}

function OneDriveInfoPopover() {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 1 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.95rem', padding: '0 0.1rem', fontWeight: 'normal' }}
        title="How does this work?"
      >
        ⓘ
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', left: 0, top: '1.6rem', zIndex: 10,
            background: 'var(--bg, #fff)', border: '1px solid var(--border, #ddd)',
            borderRadius: 6, padding: '0.75rem', width: 290, fontSize: '0.85rem',
            boxShadow: '0 2px 10px rgba(0,0,0,0.12)', lineHeight: 1.55, fontWeight: 'normal',
          }}
        >
          <p style={{ margin: '0 0 0.5rem' }}>
            Connecting OneDrive saves your files to{' '}
            <strong>Apps/MealJot Food Tracker</strong> in your OneDrive account.
          </p>
          <p style={{ margin: '0 0 0.5rem' }}>
            You can browse that folder from any device — phone, tablet, or another computer — just like any OneDrive folder.
          </p>
          <p style={{ margin: 0 }}>
            The files are plain text, so you can also ask Claude, Copilot, or any AI assistant to read or edit them for you.
          </p>
          <button
            onClick={() => setOpen(false)}
            style={{ marginTop: '0.6rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.8rem', padding: 0 }}
          >
            Close
          </button>
        </div>
      )}
    </span>
  )
}

function StorageAndSyncCard({ storageProvider, folderName }) {
  const [primary, setPrimaryLocal] = useState(storageProvider)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [providers, setProviders] = useState([])
  const [connected, setConnected] = useState({})
  const all = getAvailableProviders()

  useEffect(() => {
    try {
      const eng = getEngine()
      setProviders(eng.listProviders())
      const unsub = eng.subscribe((s) => {
        setConnected(Object.fromEntries(
          Object.entries(s.providers || {}).map(([k, v]) => [k, !!v.connected])
        ))
      })
      return () => unsub()
    } catch { /* not ready */ }
  }, [])

  const switchPrimary = async (id) => {
    if (id === primary) return
    setBusy(true)
    setError('')
    try {
      await setPrimary(id)
      setPrimaryLocal(id)
      window.location.reload()
    } catch (e) {
      setError(e.message || 'Failed to switch primary')
    } finally {
      setBusy(false)
    }
  }

  const toggleProvider = async (id) => {
    const eng = getEngine()
    setBusy(true)
    setError('')
    try {
      if (connected[id]) {
        await eng.disconnect(id)
        setConnected({ ...connected, [id]: false })
      } else {
        await eng.connect(id) // will redirect
      }
    } catch (e) {
      setError(e.message || 'Sync action failed')
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async () => {
    try { await getEngine().syncNow() } catch (e) { setError(e.message) }
  }

  return (
    <div className="card">
      <h2>Storage</h2>
      <p className="muted">
        Files live locally on this device for instant access. Optionally sync to the cloud in the background.
      </p>

      <h3 style={{ marginTop: '1rem' }}>Primary (local)</h3>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Currently: <strong>{getProviderName(primary)}</strong> ({folderName})
      </p>
      <div className="storage-option-grid">
        {all.map(id => {
          const meta = STORAGE_META[id] || {}
          const icon = { [PROVIDERS.LOCAL_STORAGE]: '🗂️', [PROVIDERS.FSA]: '💾' }[id] || '📁'
          const active = id === primary
          return (
            <button
              key={id}
              className="storage-option-card"
              onClick={() => switchPrimary(id)}
              disabled={busy || active}
              style={active ? { outline: '2px solid var(--good, #2e8b57)' } : undefined}
            >
              <div className="storage-option-header">
                <span className="storage-option-icon">{icon}</span>
                <div>
                  <div className="storage-option-name">
                    {getProviderName(id)} {active && <span style={{ fontSize: '0.7rem', color: 'var(--good, #2e8b57)' }}>(active)</span>}
                  </div>
                  <div className="storage-option-tagline">{meta.tagline}</div>
                </div>
              </div>
              <div className="storage-option-details">
                {meta.pros?.map(p => <span key={p} className="storage-tag storage-tag-pro">✓ {p}</span>)}
                {meta.cons?.map(c => <span key={c} className="storage-tag storage-tag-con">· {c}</span>)}
              </div>
            </button>
          )
        })}
      </div>

      <h3 style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        Access from other devices
        <OneDriveInfoPopover />
      </h3>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Connect OneDrive to use your food log on your phone, tablet, or any other computer.
      </p>
      {providers.length === 0 && (
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          No cloud providers configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> to enable Google Drive.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {providers.map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'rgba(0,0,0,0.03)', borderRadius: 4 }}>
            <div>
              <strong>{p.displayName}</strong>
              <div className="muted" style={{ fontSize: '0.75rem' }}>
                {connected[p.id] ? 'Connected · Apps/MealJot Food Tracker/' : 'Not connected'}
              </div>
            </div>
            <button className="btn btn-secondary" onClick={() => toggleProvider(p.id)} disabled={busy}>
              {connected[p.id] ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        ))}
      </div>
      {providers.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={syncNow}>Sync now</button>
        </div>
      )}

      {error && <div className="banner error" style={{ marginTop: '0.5rem' }}>{error}</div>}
    </div>
  )
}

export function SettingsView({ folderName, storageProvider, mode, setMode }) {
  return (
    <>
      {setMode && (
        <div className="card">
          <h2>Mode</h2>
          <div className="mode-pill" style={{ display: 'inline-flex' }}>
            <button
              className={`mode-pill-btn ${mode === 'simple' ? 'active' : ''}`}
              onClick={() => setMode('simple')}
            >Simple</button>
            <button
              className={`mode-pill-btn ${mode === 'advanced' ? 'active' : ''}`}
              onClick={() => setMode('advanced')}
            >Advanced</button>
          </div>
          <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
            {mode === 'simple'
              ? 'Simple: protein-only tracking with success/failure systems'
              : 'Advanced: full macro tracking (calories, protein, calcium, omega-3, veg)'}
          </p>
        </div>
      )}

      <StorageAndSyncCard storageProvider={storageProvider} folderName={folderName} />

      <div className="card">
        <NutritionSettings />
      </div>

      <div className="card">
        <h2>Data files</h2>
        <p className="muted">All your data lives as plain markdown in your chosen folder:</p>
        <ul className="muted">
          <li><code>daily-log.md</code> — every meal you log</li>
          <li><code>goals.md</code> — your daily nutrition targets</li>
          <li><code>recipes.md</code> — homemade items storing whole-recipe totals plus a servings count</li>
        </ul>
        <p className="muted">Edit them in any text editor; the app will pick up changes.</p>
      </div>
    </>
  )
}




