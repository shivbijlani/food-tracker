import { useState, useEffect, useCallback, useMemo } from 'react'
import { BRAND } from './branding.js'
import {
  InstallButton, InstallModal, InstallNudge, InstallSuccessToast,
} from '../packages/install-prompt/src/index.js'
import '../packages/install-prompt/src/styles/install-prompt.css'
import { storage, getEngine, initStorage, detectModeFromData, registerSyncWorker, PROVIDERS, getProviderName, getAvailableProviders, getPrimaryId, setPrimary } from './storage/storage.js'
import {
  DAILY_LOG_HEADERS, GOALS_HEADERS, RECIPE_HEADERS,
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
import { openSettings } from './SettingsButton.jsx'
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
      const [curText, goalsText, recipesText, suggestionsText] = await Promise.all([
        storage.readFile(curName),
        storage.readFile('goals.md'),
        storage.readFile('recipes.md'),
        storage.readFile(SUGGESTIONS_FILE),
      ])
      setLogEntries(readEntries(curText, DAILY_LOG_HEADERS).rows)
      setGoals(readEntries(goalsText, GOALS_HEADERS).rows)
      const recipeRows = readEntries(recipesText, RECIPE_HEADERS).rows
      setRecipes(recipeRows)
      setSuggestions(parseSuggestions(suggestionsText || ''))
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

  const upsertSuggestionAndSave = async (item) => {
    const next = upsertSuggestion(suggestions, item)
    setSuggestions(next)
    try {
      await storage.writeFile(SUGGESTIONS_FILE, serializeSuggestions(next))
    } catch (e) {
      console.warn('Failed to persist suggestions.csv:', e)
    }
  }

  const addEntry = async (entry) => {
    await saveLog(mergeEntry(logEntries, entry, 'advanced'))
    // Upsert into the food database — whatever the user typed becomes a
    // suggestion next time (commas and all; the user is the curator).
    if (entry?.['Food Description']) {
      await upsertSuggestionAndSave({
        name: entry['Food Description'],
        protein_g: entry['Protein (g)'],
        calories: entry.Calories,
        calcium_mg: entry['Calcium (mg)'],
        veg_servings: entry['Veg Servings'],
        omega3: entry['Omega-3'],
      })
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

  const addEntryWithCoaching = async (entry) => {
    await addEntry(entry)
    // Pass all entries for this meal so coaching reflects the full session,
    // not just the single item that was just saved.
    const sameMeal = logEntries.filter(
      e => e.Date === entry.Date && e.Meal === entry.Meal
    )
    requestCoaching(entry.Meal || '', entry['Protein (g)'] || '', [...sameMeal, entry])
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

      {tab === 'today' && <TodayView entries={logEntries} goals={goals} onAdd={addEntryWithCoaching} onUpdate={updateEntry} onDelete={deleteEntry} recipes={recipes} suggestions={suggestions} />}
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

function TodayView({ entries, goals, onAdd, onUpdate, onDelete, recipes, suggestions }) {
  const today = todayStr()
  const todays = entries.filter(e => e.Date === today)

  const totals = todays.reduce((acc, e) => ({
    calories: acc.calories + num(e.Calories),
    protein: acc.protein + num(e['Protein (g)']),
    calcium: acc.calcium + num(e['Calcium (mg)']),
    veg: acc.veg + num(e['Veg Servings']),
    omega3: acc.omega3 || e['Omega-3'] === 'Y',
  }), { calories: 0, protein: 0, calcium: 0, veg: 0, omega3: false })

  const goalMap = Object.fromEntries(goals.map(g => [g.Nutrient, parseGoalTarget(g.Target)]))

  const rows = [
    { label: 'Calories', value: totals.calories, unit: 'kcal', goal: goalMap.Calories },
    { label: 'Protein', value: totals.protein, unit: 'g', goal: goalMap.Protein },
    { label: 'Calcium', value: totals.calcium, unit: 'mg', goal: goalMap.Calcium },
    { label: 'Vegetables', value: totals.veg, unit: 'srv', goal: goalMap.Vegetables },
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

function AddEntry({ onAdd, recipes, defaultDate, suggestions: suggestionsCsv = [] }) {
  const [date, setDate] = useState(defaultDate)
  const [meal, setMeal] = useState('Breakfast')
  const [desc, setDesc] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)

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
    setPreview({
      calories: s.calories,
      protein_g: s.protein,
      calcium_mg: s.calcium_mg,
      veg_servings: s.veg_servings,
      omega3: s.omega3 || 'N',
      confidence: 'high',
    })
  }

  const estimate = async () => {
    if (!desc.trim()) return
    setBusy(true); setErr(''); setPreview(null)
    try {
      const result = await llm.estimateNutrition(desc, { recipes })
      setPreview(result)
    } catch (e) {
      setErr(e.message)
      if (e.code === 'LLM_NOT_CONFIGURED') openSettings('settings-llm')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!preview) return
    const entry = {
      Date: date,
      Meal: meal,
      'Food Description': desc.trim(),
      Calories: preview.calories,
      'Protein (g)': preview.protein_g,
      'Calcium (mg)': preview.calcium_mg,
      'Veg Servings': preview.veg_servings,
      'Omega-3': preview.omega3,
      Notes: '',
    }
    await onAdd(entry)
    setDesc(''); setPreview(null); setErr(''); setEditing(false)
  }

  const updatePreview = (key, val) => setPreview(p => ({ ...p, [key]: val }))

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

      {err && <div className="banner error">{err}</div>}

      {!preview && (
        <button className="btn" onClick={estimate} disabled={busy || !desc.trim()}>
          {busy ? <><span className="spinner" />Estimating…</> : '✨ Estimate nutrition'}
        </button>
      )}

      {preview && (
        <div className="preview-card">
          <div className="flex justify-between items-center">
            <strong>Estimated nutrition</strong>
            <span className={`muted confidence-${preview.confidence}`}>
              confidence: {preview.confidence}
            </span>
          </div>
          <div className="stat-grid">
            {editing ? (
              <>
                <NumStat label="Calories" value={preview.calories} onChange={v => updatePreview('calories', v)} />
                <NumStat label="Protein (g)" value={preview.protein_g} onChange={v => updatePreview('protein_g', v)} />
                <NumStat label="Calcium (mg)" value={preview.calcium_mg} onChange={v => updatePreview('calcium_mg', v)} />
                <NumStat label="Veg srv" value={preview.veg_servings} step="0.5" onChange={v => updatePreview('veg_servings', v)} />
                <div className="stat">
                  <select value={preview.omega3} onChange={e => updatePreview('omega3', e.target.value)} style={{ width: '100%' }}>
                    <option value="Y">Omega-3 Y</option>
                    <option value="N">Omega-3 N</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="stat"><div className="v">{preview.calories}</div><div className="l">kcal</div></div>
                <div className="stat"><div className="v">{preview.protein_g}</div><div className="l">protein g</div></div>
                <div className="stat"><div className="v">{preview.calcium_mg}</div><div className="l">calcium mg</div></div>
                <div className="stat"><div className="v">{preview.veg_servings}</div><div className="l">veg srv</div></div>
                <div className="stat"><div className="v">{preview.omega3}</div><div className="l">omega-3</div></div>
              </>
            )}
          </div>
          <div className="flex gap-8" style={{ marginTop: 12 }}>
            <button className="btn" onClick={save}>Save entry</button>
            <button className="btn btn-secondary" onClick={() => setEditing(!editing)}>
              {editing ? 'Done editing' : 'Edit values'}
            </button>
            <button className="btn btn-secondary" onClick={() => setPreview(null)}>Discard</button>
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
        }), { cal: 0, pro: 0, ca: 0, veg: 0 })
        return (
          <div key={date} className="day-section">
            <div className="day-header">
              <h3>{date}</h3>
              <span className="day-totals">
                {Math.round(totals.cal)} kcal · {Math.round(totals.pro)}g pro · {Math.round(totals.ca)}mg Ca · {totals.veg} veg
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
        <p className="muted">Per-serving nutrition for homemade items. Mention them by name when logging meals for accurate estimates.</p>
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
  const [orConnected, setOrConnected] = useState(openrouterAuth.isConnected())
  const [orModel, setOrModel] = useState(() => llm.getModel('openrouter'))
  const [activeProvider, setActiveProvider] = useState(llm.getProvider())
  const [saved, setSaved] = useState(false)
  const [showManual, setShowManual] = useState(!openrouterAuth.isConnected())

  // Manual key section state
  const initManualProvider = () => {
    const p = llm.getProvider()
    return p === 'openrouter' ? 'github' : p
  }
  const [manualProvider, setManualProvider] = useState(initManualProvider)
  const [apiKey, setApiKeyState] = useState(() => llm.getApiKey(manualProvider))
  const [model, setModelState] = useState(() => llm.getModel(manualProvider))

  const handleManualProviderChange = (p) => {
    setManualProvider(p)
    setApiKeyState(llm.getApiKey(p))
    setModelState(llm.getModel(p))
  }

  const activateOpenRouter = () => {
    llm.setModel(orModel || llm.PROVIDERS.openrouter.defaultModel, 'openrouter')
    llm.setProvider('openrouter')
    setActiveProvider('openrouter')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleDisconnectOpenRouter = () => {
    openrouterAuth.clearKey()
    setOrConnected(false)
    if (activeProvider === 'openrouter') {
      llm.setProvider('github')
      setActiveProvider('github')
    }
    setShowManual(true)
  }

  const saveManualSettings = () => {
    llm.setProvider(manualProvider)
    llm.setApiKey(apiKey.trim(), manualProvider)
    llm.setModel(model.trim(), manualProvider)
    setActiveProvider(manualProvider)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const manualProviderInfo = llm.PROVIDERS[manualProvider]
  const isOrActive = activeProvider === 'openrouter'

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

      <div className="card" id="settings-llm">
        <h2>Nutrition Estimation</h2>

        {/* OpenRouter OAuth option */}
        <div className={`llm-option-card${isOrActive ? ' llm-option-active' : ''}`}>
          <div className="llm-option-header">
            <span className="llm-option-icon">🔀</span>
            <div style={{ flex: 1 }}>
              <div className="llm-option-name">
                OpenRouter
                {!orConnected && <span className="llm-badge-recommended">Recommended</span>}
                {isOrActive && <span className="llm-badge-active">✓ Active</span>}
              </div>
              <div className="llm-option-tagline">Sign in once — works automatically with free AI models</div>
            </div>
          </div>

          {orConnected ? (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {!isOrActive && (
                  <button className="btn" onClick={activateOpenRouter}>Use OpenRouter</button>
                )}
                {isOrActive && saved && <span style={{ color: 'var(--good)' }}>Saved ✓</span>}
                <button className="btn btn-secondary" onClick={handleDisconnectOpenRouter}>Disconnect</button>
              </div>
              <details style={{ marginTop: '0.75rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--muted)' }}>
                  Advanced: choose a specific model
                </summary>
                <div className="field" style={{ marginTop: '0.5rem' }}>
                  <label>Model</label>
                  <input
                    value={orModel}
                    onChange={e => setOrModel(e.target.value)}
                    placeholder={llm.PROVIDERS.openrouter.defaultModel}
                  />
                  <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Leave blank for automatic (free). Or enter a specific model from <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">openrouter.ai/models</a>.
                  </div>
                </div>
                {isOrActive && !saved && (
                  <button className="btn btn-secondary" onClick={activateOpenRouter}>Save model</button>
                )}
              </details>
            </div>
          ) : (
            <div style={{ marginTop: '0.75rem' }}>
              <p className="muted" style={{ fontSize: '0.9rem' }}>
                No manual key needed — connect once with your OpenRouter account.
                You control your credit limits and can revoke access anytime from <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">openrouter.ai</a>.
              </p>
              <button className="btn" onClick={() => openrouterAuth.startAuth()}>
                Connect with OpenRouter →
              </button>
            </div>
          )}
        </div>

        {/* Manual API key toggle */}
        <button
          className="btn btn-secondary"
          style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}
          onClick={() => setShowManual(s => !s)}
        >
          {showManual ? '▾' : '▸'} Use a manual API key instead
        </button>

        {showManual && (
          <div style={{ marginTop: '0.75rem' }}>
            <div className="field">
              <label>Provider</label>
              <select value={manualProvider} onChange={e => handleManualProviderChange(e.target.value)}>
                {Object.entries(llm.PROVIDERS).filter(([k]) => k !== 'openrouter').map(([key, p]) => (
                  <option key={key} value={key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>API key</label>
              <input
                type="password"
                placeholder={manualProviderInfo.keyPlaceholder}
                value={apiKey}
                onChange={e => setApiKeyState(e.target.value)}
                autoComplete="off"
              />
              {manualProvider === 'github' ? (
                <div className="muted" style={{fontSize:'0.85rem', marginTop: '0.5rem', lineHeight: '1.7'}}>
                  <strong>Free — no billing required.</strong> To get your token:
                  <ol style={{margin: '0.4rem 0 0 1.2rem', padding: 0}}>
                    <li>Go to <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">github.com/settings/personal-access-tokens/new</a></li>
                    <li>Give it any name (e.g. <em>mealjot</em>)</li>
                    <li>Under <strong>Account permissions</strong> → <strong>Models</strong> → set to <strong>Read-only</strong></li>
                    <li>Click <strong>Generate token</strong>, copy it, paste above</li>
                  </ol>
                  Rate limits: ~150 low-tier requests/day (more than enough for food logging).
                </div>
              ) : manualProvider === 'openai' ? (
                <div className="muted" style={{fontSize:'0.85rem', marginTop: '0.5rem', lineHeight: '1.7'}}>
                  <strong>Pay-as-you-go.</strong> ~$0.00015 per estimate with gpt-4o-mini.{' '}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get your key →</a>
                  <div style={{marginTop: '0.4rem'}}>
                    <button className="btn btn-secondary" style={{fontSize:'0.8rem', padding:'0.2rem 0.6rem'}}
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText()
                          if (text.startsWith('sk-')) setApiKeyState(text.trim())
                          else alert('Clipboard does not contain an OpenAI key (should start with sk-)')
                        } catch { alert('Could not read clipboard. Paste the key manually.') }
                      }}>📋 Paste from clipboard</button>
                  </div>
                </div>
              ) : manualProvider === 'claude' ? (
                <div className="muted" style={{fontSize:'0.85rem', marginTop: '0.5rem', lineHeight: '1.7'}}>
                  <strong>Pay-as-you-go.</strong> ~$0.0001 per estimate with Claude Haiku.{' '}
                  <a href="https://console.anthropic.com/settings/api-keys" target="_blank" rel="noreferrer">Get your key →</a>
                  <div style={{marginTop: '0.4rem'}}>
                    <button className="btn btn-secondary" style={{fontSize:'0.8rem', padding:'0.2rem 0.6rem'}}
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText()
                          if (text.startsWith('sk-ant-')) setApiKeyState(text.trim())
                          else alert('Clipboard does not contain an Anthropic key (should start with sk-ant-)')
                        } catch { alert('Could not read clipboard. Paste the key manually.') }
                      }}>📋 Paste from clipboard</button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="field">
              <label>Model</label>
              <input
                value={model}
                onChange={e => setModelState(e.target.value)}
                placeholder={manualProviderInfo.defaultModel}
              />
            </div>
            <div className="flex gap-8 items-center">
              <button className="btn" onClick={saveManualSettings}>Save</button>
              {saved && !isOrActive && <span style={{ color: 'var(--good)' }}>Saved ✓</span>}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Data files</h2>
        <p className="muted">All your data lives as plain markdown in your chosen folder:</p>
        <ul className="muted">
          <li><code>daily-log.md</code> — every meal you log</li>
          <li><code>goals.md</code> — your daily nutrition targets</li>
          <li><code>recipes.md</code> — homemade items with known per-serving nutrition</li>
        </ul>
        <p className="muted">Edit them in any text editor; the app will pick up changes.</p>
      </div>
    </>
  )
}




