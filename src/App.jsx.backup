import { useState, useEffect, useCallback } from 'react'
import * as fsa from './storage/fsa.js'
import {
  parseTable, rowsToObjects, objectsToRows, replaceFirstTable,
  DAILY_LOG_HEADERS, GOALS_HEADERS, RECIPE_HEADERS,
} from './storage/markdown.js'
import * as llm from './llm.js'
import SimpleMode, { ModePill } from './SimpleMode.jsx'

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'log', label: 'Log' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'goals', label: 'Goals' },
  { id: 'settings', label: 'Settings' },
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
  const [handle, setHandle] = useState(null)
  const [folderName, setFolderName] = useState('')
  const [tab, setTab] = useState('today')
  const [logEntries, setLogEntries] = useState([])
  const [goals, setGoals] = useState([])
  const [recipes, setRecipes] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [mode, setModeState] = useState(() => localStorage.getItem('food-tracker-mode') || 'advanced')

  const switchMode = (m) => {
    localStorage.setItem('food-tracker-mode', m)
    setModeState(m)
  }

  const supported = fsa.isSupported()

  // Try to restore folder on load
  useEffect(() => {
    if (!supported) { setLoading(false); return }
    fsa.restoreFolder().then(h => {
      if (h) {
        setHandle(h)
        setFolderName(h.name)
      }
      setLoading(false)
    })
  }, [supported])

  const loadAll = useCallback(async (h) => {
    if (!h) return
    try {
      await fsa.scaffoldIfEmpty(h)
      const [logText, goalsText, recipesText] = await Promise.all([
        fsa.readFile(h, 'daily-log.md'),
        fsa.readFile(h, 'goals.md'),
        fsa.readFile(h, 'recipes.md'),
      ])
      setLogEntries(rowsToObjects(...Object.values(parseTable(logText, DAILY_LOG_HEADERS)).slice(0, 2)))
      setGoals(rowsToObjects(...Object.values(parseTable(goalsText, GOALS_HEADERS)).slice(0, 2)))
      setRecipes(rowsToObjects(...Object.values(parseTable(recipesText, RECIPE_HEADERS)).slice(0, 2)))
      setError('')
    } catch (e) {
      setError(`Load error: ${e.message}`)
    }
  }, [])

  useEffect(() => { if (handle) loadAll(handle) }, [handle, loadAll])

  const pickFolder = async () => {
    try {
      const h = await fsa.pickFolder()
      setHandle(h)
      setFolderName(h.name)
    } catch (e) {
      if (e.name !== 'AbortError') setError(`Pick error: ${e.message}`)
    }
  }

  const saveLog = async (newEntries) => {
    const sorted = [...newEntries].sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0))
    const original = await fsa.readFile(handle, 'daily-log.md')
    const next = replaceFirstTable(original, DAILY_LOG_HEADERS, objectsToRows(DAILY_LOG_HEADERS, sorted))
    await fsa.writeFile(handle, 'daily-log.md', next)
    setLogEntries(sorted)
  }

  const saveRecipes = async (newRecipes) => {
    const original = await fsa.readFile(handle, 'recipes.md')
    const next = replaceFirstTable(original, RECIPE_HEADERS, objectsToRows(RECIPE_HEADERS, newRecipes))
    await fsa.writeFile(handle, 'recipes.md', next)
    setRecipes(newRecipes)
  }

  const addEntry = async (entry) => {
    await saveLog([entry, ...logEntries])
  }

  const deleteEntry = async (idx) => {
    await saveLog(logEntries.filter((_, i) => i !== idx))
  }

  if (loading) return <div className="app"><div className="empty">Loading…</div></div>

  if (!supported) {
    return (
      <div className="app">
        <div className="banner error">
          This browser doesn't support the File System Access API. Use Chrome, Edge, or another Chromium-based browser.
        </div>
      </div>
    )
  }

  if (!handle) {
    return (
      <div className="app">
        <div className="welcome">
          <h1>🥗 Food Tracker</h1>
          <p>Pick a folder to store your food log. Your data lives in markdown files you own.</p>
          <button className="btn" onClick={pickFolder}>Choose folder</button>
        </div>
      </div>
    )
  }

  if (mode === 'simple') {
    return <SimpleMode handle={handle} folderName={folderName} onPickFolder={pickFolder} mode={mode} setMode={switchMode} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">🥗 Food Tracker</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="folder-pill" title="Storage folder">📁 {folderName}</span>
          <ModePill mode={mode} setMode={switchMode} />
        </div>
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

      {tab === 'today' && <TodayView entries={logEntries} goals={goals} onAdd={addEntry} recipes={recipes} />}
      {tab === 'log' && <LogView entries={logEntries} onDelete={deleteEntry} />}
      {tab === 'recipes' && <RecipesView recipes={recipes} onSave={saveRecipes} />}
      {tab === 'goals' && <GoalsView goals={goals} />}
      {tab === 'settings' && <SettingsView onChangeFolder={pickFolder} folderName={folderName} onSwitchMode={() => switchMode('simple')} />}
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
        <p className="muted">Per-serving nutrition for homemade items. Mention them by name when logging meals to help the LLM estimate accurately.</p>
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

function SettingsView({ onChangeFolder, folderName, onSwitchMode }) {
  const [provider, setProviderState] = useState(llm.getProvider())
  const [apiKey, setApiKeyState] = useState(() => llm.getApiKey(llm.getProvider()))
  const [model, setModelState] = useState(() => llm.getModel(llm.getProvider()))
  const [saved, setSaved] = useState(false)

  const handleProviderChange = (p) => {
    setProviderState(p)
    setApiKeyState(llm.getApiKey(p))
    setModelState(llm.getModel(p))
  }

  const saveSettings = () => {
    llm.setProvider(provider)
    llm.setApiKey(apiKey.trim(), provider)
    llm.setModel(model.trim(), provider)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const providerInfo = llm.PROVIDERS[provider]

  return (
    <>
      <div className="card">
        <h2>Storage Folder</h2>
        <p className="muted">Currently: <strong>{folderName}</strong></p>
        <button className="btn btn-secondary" onClick={onChangeFolder}>Change folder…</button>
      </div>

      <div className="card">
        <h2>LLM for Nutrition Estimation</h2>
        <p className="muted">
          Used to estimate nutrition from food descriptions. Your API key is stored only in your browser's localStorage.
        </p>
        <div className="field">
          <label>Provider</label>
          <select value={provider} onChange={e => handleProviderChange(e.target.value)}>
            {Object.entries(llm.PROVIDERS).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>API key</label>
          <input
            type="password"
            placeholder={providerInfo.keyPlaceholder}
            value={apiKey}
            onChange={e => setApiKeyState(e.target.value)}
            autoComplete="off"
          />
          {provider === 'github' ? (
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
          ) : (
            <span className="muted" style={{fontSize:'0.8rem'}}>
              Get a key at <a href={providerInfo.keyUrl} target="_blank" rel="noreferrer">{providerInfo.keyUrl}</a>
            </span>
          )}
        </div>
        <div className="field">
          <label>Model</label>
          <input
            value={model}
            onChange={e => setModelState(e.target.value)}
            placeholder={providerInfo.defaultModel}
          />
        </div>
        <div className="flex gap-8 items-center">
          <button className="btn" onClick={saveSettings}>Save</button>
          {saved && <span style={{ color: 'var(--good)' }}>Saved ✓</span>}
        </div>
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

      <div className="card">
        <h2>App Mode</h2>
        <p className="muted">Switch to Simple Mode for protein-only tracking with a streamlined interface.</p>
        <button className="btn btn-secondary" onClick={onSwitchMode}>Switch to Simple Mode</button>
      </div>
    </>
  )
}
