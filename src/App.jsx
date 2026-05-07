import { useState, useEffect, useCallback } from 'react'
import { storage, getProvider, setProvider, PROVIDERS, getProviderName, getAvailableProviders } from './storage/storage.js'
import {
  parseTable, rowsToObjects, objectsToRows, replaceFirstTable,
  DAILY_LOG_HEADERS, GOALS_HEADERS, RECIPE_HEADERS,
} from './storage/markdown.js'
import { LocalStorageProvider } from './storage/localstorage-provider.js'
import { migrate, resumePendingMigration, hasPendingMigration, makeProvider } from './storage/migrate.js'
import * as llm from './llm.js'
import * as openrouterAuth from './openrouter-auth.js'
import SimpleMode from './SimpleMode.jsx'
import { SettingsButton } from './SettingsButton.jsx'

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
  const [logEntries, setLogEntries] = useState([])
  const [goals, setGoals] = useState([])
  const [recipes, setRecipes] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [mode, setModeState] = useState(() => localStorage.getItem('food-tracker-mode') || 'advanced')
  const [orConnectedBanner, setOrConnectedBanner] = useState(false)

  const switchMode = (m) => {
    localStorage.setItem('food-tracker-mode', m)
    setModeState(m)
  }

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
        // 1. If returning from OAuth redirect with a pending migration, finish it
        if (hasPendingMigration()) {
          const result = await resumePendingMigration()
          if (result) {
            await handleStorageReady(result.toId)
            if (result.error) setError(result.error)
            setLoading(false)
            return
          }
        }

        // 2. Look for saved provider
        const savedId = localStorage.getItem('storage-provider') || PROVIDERS.LOCAL_STORAGE
        const provider = makeProvider(savedId)
        const ok = await provider.init()
        if (ok && await provider.isReady()) {
          setProvider(provider)
          localStorage.setItem('storage-provider', savedId)
          await handleStorageReady(savedId)
        } else if (savedId !== PROVIDERS.LOCAL_STORAGE) {
          // Cloud auth failed — fall back to localStorage so user isn't locked out
          const fallback = new LocalStorageProvider()
          await fallback.init()
          setProvider(fallback)
          localStorage.setItem('storage-provider', PROVIDERS.LOCAL_STORAGE)
          await handleStorageReady(PROVIDERS.LOCAL_STORAGE)
          setError(`Could not restore ${getProviderName(savedId)}. Using browser storage.`)
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
      await storage.scaffold(mode === 'simple')
      const [logText, goalsText, recipesText] = await Promise.all([
        storage.readFile('daily-log.md'),
        storage.readFile('goals.md'),
        storage.readFile('recipes.md'),
      ])
      setLogEntries(rowsToObjects(...Object.values(parseTable(logText, DAILY_LOG_HEADERS)).slice(0, 2)))
      setGoals(rowsToObjects(...Object.values(parseTable(goalsText, GOALS_HEADERS)).slice(0, 2)))
      setRecipes(rowsToObjects(...Object.values(parseTable(recipesText, RECIPE_HEADERS)).slice(0, 2)))
      setError('')
    } catch (e) {
      setError(`Load error: ${e.message}`)
    }
  }, [storageReady, mode])

  useEffect(() => { 
    if (storageReady) {
      loadAll()
      setLoading(false)
    }
  }, [storageReady, loadAll])

  const saveLog = async (newEntries) => {
    const sorted = [...newEntries].sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0))
    const original = await storage.readFile('daily-log.md')
    const next = replaceFirstTable(original, DAILY_LOG_HEADERS, objectsToRows(DAILY_LOG_HEADERS, sorted))
    await storage.writeFile('daily-log.md', next)
    setLogEntries(sorted)
  }

  const saveRecipes = async (newRecipes) => {
    const original = await storage.readFile('recipes.md')
    const next = replaceFirstTable(original, RECIPE_HEADERS, objectsToRows(RECIPE_HEADERS, newRecipes))
    await storage.writeFile('recipes.md', next)
    setRecipes(newRecipes)
  }

  const addEntry = async (entry) => {
    await saveLog([entry, ...logEntries])
  }

  const deleteEntry = async (idx) => {
    await saveLog(logEntries.filter((_, i) => i !== idx))
  }

  if (loading) return <div className="app"><div className="empty">Loading…</div></div>

  if (!storageReady) {
    return <div className="app"><div className="empty">Initializing storage…</div></div>
  }

  if (mode === 'simple') {
    return <SimpleMode storageReady={storageReady} folderName={folderName} mode={mode} setMode={switchMode} storageProvider={storageProvider} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          🥗 Food Tracker
          <span className="folder-pill" title="Storage location">📁 {folderName}</span>
        </h1>
        <SettingsButton mode={mode} setMode={switchMode} folderName={folderName} storageProvider={storageProvider} />
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
      {orConnectedBanner && (
        <div className="banner" style={{ background: 'var(--good)', color: '#fff' }}>
          ✅ OpenRouter connected! You can now estimate nutrition using GPT-4o-mini and 400+ other models.
        </div>
      )}

      {tab === 'today' && <TodayView entries={logEntries} goals={goals} onAdd={addEntry} recipes={recipes} />}
      {tab === 'log' && <LogView entries={logEntries} onDelete={deleteEntry} />}
      {tab === 'recipes' && <RecipesView recipes={recipes} onSave={saveRecipes} />}
      {tab === 'goals' && <GoalsView goals={goals} />}
    </div>
  )
}

function TodayView({ entries, goals, onAdd, recipes }) {
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

      <AddEntry onAdd={onAdd} recipes={recipes} defaultDate={today} />

      <div className="card">
        <h2>Today's Entries ({todays.length})</h2>
        {todays.length === 0 ? (
          <div className="empty">Nothing logged yet today.</div>
        ) : todays.map((e, i) => <EntryRow key={i} entry={e} />)}
      </div>
    </>
  )
}

function AddEntry({ onAdd, recipes, defaultDate }) {
  const [date, setDate] = useState(defaultDate)
  const [meal, setMeal] = useState('Breakfast')
  const [desc, setDesc] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => { setDate(defaultDate) }, [defaultDate])

  const estimate = async () => {
    if (!desc.trim()) return
    setBusy(true); setErr(''); setPreview(null)
    try {
      const result = await llm.estimateNutrition(desc, { recipes })
      setPreview(result)
    } catch (e) {
      setErr(e.message)
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
        <textarea
          placeholder="e.g. 2 eggs, 1/2 avocado toast, 1 cup Greek yogurt with walnuts"
          value={desc}
          onChange={e => setDesc(e.target.value)}
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

function EntryRow({ entry, onDelete }) {
  return (
    <div className="entry">
      <div className="entry-header">
        <span><strong>{entry.Meal || '—'}</strong></span>
        <span>
          {entry.Date}
          {onDelete && <button className="icon-btn" title="Delete" onClick={onDelete} style={{ marginLeft: 8 }}>🗑</button>}
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

function LogView({ entries, onDelete }) {
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
              return <EntryRow key={i} entry={e} onDelete={() => onDelete(globalIdx)} />
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
          <table className="simple">
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
  [PROVIDERS.ONEDRIVE]: {
    tagline: 'Sync across all your devices',
    pros: ['Access from any device', 'Automatic backup'],
    cons: ['Requires Microsoft account'],
  },
  [PROVIDERS.GOOGLE_DRIVE]: {
    tagline: 'Sync across all your devices',
    pros: ['Access from any device', 'Automatic backup'],
    cons: ['Requires Google account'],
  },
}

function MigrateStorageCard({ storageProvider, folderName }) {
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [keepSource, setKeepSource] = useState(true)
  const all = getAvailableProviders()
  const others = all.filter(id => id !== storageProvider)
  const isCloud = (id) => id === PROVIDERS.ONEDRIVE || id === PROVIDERS.GOOGLE_DRIVE

  const startMigrate = async (toId) => {
    setError('')
    setBusy(true)
    try {
      const result = await migrate(getProvider(), toId, {
        deleteSource: !keepSource,
        fromId: storageProvider,
      })
      if (result.ok) {
        window.location.reload()
        return
      }
      if (result.redirected) return
      setError(result.error || 'Migration failed')
    } catch (e) {
      setError(e.message || 'Migration failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>Storage</h2>
      <p className="muted">
        Currently using: <strong>{getProviderName(storageProvider)}</strong> ({folderName})
      </p>

      {!confirming && (
        <>
          <p className="muted" style={{ marginTop: '0.25rem', marginBottom: '1rem' }}>
            Choose where to store your data. You can switch at any time.
          </p>
          <div className="storage-option-grid">
            {others.map(id => {
              const meta = STORAGE_META[id] || {}
              const icon = { [PROVIDERS.LOCAL_STORAGE]: '🗂️', [PROVIDERS.FSA]: '💾', [PROVIDERS.ONEDRIVE]: '☁️', [PROVIDERS.GOOGLE_DRIVE]: '🌐' }[id] || '📁'
              return (
                <button key={id} className="storage-option-card" onClick={() => setConfirming(id)} disabled={busy}>
                  <div className="storage-option-header">
                    <span className="storage-option-icon">{icon}</span>
                    <div>
                      <div className="storage-option-name">{getProviderName(id)}</div>
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
        </>
      )}

      {confirming && (
        <div className="banner info" style={{ marginTop: '0.75rem' }}>
          <p>
            <strong>Switch to {getProviderName(confirming)}?</strong> Your data will be copied there.
            You can keep using the app normally afterward.
          </p>
          {storageProvider === PROVIDERS.LOCAL_STORAGE && (
            <label style={{ display: 'block', margin: '0.5rem 0' }}>
              <input
                type="checkbox"
                checked={!keepSource}
                onChange={e => setKeepSource(!e.target.checked)}
              />{' '}
              Delete browser storage copy after switching
            </label>
          )}
          {isCloud(confirming) && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              You'll be redirected to sign in. Your data will be copied over automatically when you return.
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button className="btn" onClick={() => startMigrate(confirming)} disabled={busy}>
              {busy ? 'Switching…' : 'Switch'}
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && <div className="banner error" style={{ marginTop: '0.5rem' }}>{error}</div>}
        </div>
      )}
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

      <MigrateStorageCard storageProvider={storageProvider} folderName={folderName} />

      <div className="card">
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
              <div className="field">
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
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {!isOrActive && (
                  <button className="btn" onClick={activateOpenRouter}>Use OpenRouter</button>
                )}
                {isOrActive && saved && <span style={{ color: 'var(--good)' }}>Saved ✓</span>}
                {isOrActive && !saved && (
                  <button className="btn btn-secondary" onClick={activateOpenRouter}>Save model</button>
                )}
                <button className="btn btn-secondary" onClick={handleDisconnectOpenRouter}>Disconnect</button>
              </div>
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
                    <li>Give it any name (e.g. <em>food-tracker</em>)</li>
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


