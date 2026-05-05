import { useState, useEffect, useCallback } from 'react'
import { storage } from './storage/storage.js'
import {
  parseTable, rowsToObjects, objectsToRows, replaceFirstTable,
  PROTEIN_LOG_HEADERS, GOALS_HEADERS,
} from './storage/markdown.js'
import * as llm from './llm.js'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function num(v) {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

function parseGoalTarget(target) {
  if (!target) return null
  const m = String(target).match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/)
  if (!m) return null
  const lo = Number(m[1])
  const hi = m[2] ? Number(m[2]) : lo
  return { lo, hi, mid: (lo + hi) / 2 }
}

// Get Sunday of the week containing the given date string
function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const sun = new Date(d)
  sun.setDate(d.getDate() - day)
  return sun
}

function formatWeekLabel(sunDate, satDate) {
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(sunDate)} – ${fmt(satDate)}`
}

function groupByWeek(entries) {
  const weeks = {}
  for (const e of entries) {
    if (!e.Date) continue
    const sun = weekStart(e.Date)
    const key = sun.toISOString().slice(0, 10)
    if (!weeks[key]) weeks[key] = []
    weeks[key].push(e)
  }
  // Sort keys descending
  return Object.entries(weeks).sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
}

function currentWeekKey() {
  const sun = weekStart(todayStr())
  return sun.toISOString().slice(0, 10)
}

export default function SimpleMode({ storageReady, folderName, mode, setMode }) {
  const [entries, setEntries] = useState([])
  const [goals, setGoals] = useState([])
  const [systemsText, setSystemsText] = useState('')
  const [error, setError] = useState('')

  // Collapsible panels
  const [progressOpen, setProgressOpen] = useState(true)
  const [addOpen, setAddOpen] = useState(true)
  const [systemsOpen, setSystemsOpen] = useState(false)

  // Plan fields (localStorage-backed)
  const [planText, setPlanText] = useState(() => localStorage.getItem('food-tracker-plan-text') || '')
  const [planProtein, setPlanProtein] = useState(() => Number(localStorage.getItem('food-tracker-plan-protein')) || 0)

  // Week expand state
  const [expandedWeeks, setExpandedWeeks] = useState(() => new Set([currentWeekKey()]))

  const loadAll = useCallback(async () => {
    if (!storageReady) return
    try {
      await storage.scaffold(true) // true for simple mode
      const [logText, goalsText, sysText] = await Promise.all([
        storage.readFile('protein-log.md').catch(() => ''),
        storage.readFile('goals.md').catch(() => ''),
        storage.readFile('systems.md').catch(() => ''),
      ])
      const parsed = parseTable(logText, PROTEIN_LOG_HEADERS)
      setEntries(rowsToObjects(parsed.headers.length ? parsed.headers : PROTEIN_LOG_HEADERS, parsed.rows))
      const gParsed = parseTable(goalsText, GOALS_HEADERS)
      setGoals(rowsToObjects(gParsed.headers.length ? gParsed.headers : GOALS_HEADERS, gParsed.rows))
      setSystemsText(sysText)
      setError('')
    } catch (e) {
      setError(`Load error: ${e.message}`)
    }
  }, [storageReady])

  useEffect(() => { if (storageReady) loadAll() }, [storageReady, loadAll])

  const saveLog = async (newEntries) => {
    const sorted = [...newEntries].sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0))
    const original = await storage.readFile('protein-log.md').catch(() => '')
    const next = replaceFirstTable(original, PROTEIN_LOG_HEADERS, objectsToRows(PROTEIN_LOG_HEADERS, sorted))
    await storage.writeFile('protein-log.md', next)
    setEntries(sorted)
  }

  const addEntry = async (entry) => {
    await saveLog([entry, ...entries])
  }

  const deleteEntry = async (idx) => {
    await saveLog(entries.filter((_, i) => i !== idx))
  }

  const toggleWeek = (key) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Protein goal
  const goalRow = goals.find(g => /protein/i.test(g.Nutrient || g['Nutrient / Metric'] || ''))
  const proteinGoal = goalRow ? (parseGoalTarget(goalRow.Target)?.mid ?? 100) : 100

  // Today's totals
  const today = todayStr()
  const todayEntries = entries.filter(e => e.Date === today)
  const eaten = todayEntries.reduce((s, e) => s + num(e['Protein (g)']), 0)
  const planned = planProtein
  const gap = Math.max(0, proteinGoal - eaten - planned)

  // Progress bar percentages
  const eatenPct = Math.min(100, (eaten / proteinGoal) * 100)
  const plannedPct = Math.min(100 - eatenPct, (planned / proteinGoal) * 100)

  // Time marker (7am–7pm window)
  const now = new Date()
  const hour = now.getHours() + now.getMinutes() / 60
  const timePct = Math.min(100, Math.max(0, ((hour - 7) / 12) * 100))

  // Weekly log
  const weeks = groupByWeek(entries)

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">🥗 Food Tracker</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {folderName && <span className="folder-pill" title="Storage folder">📁 {folderName}</span>}
          <ModePill mode={mode} setMode={setMode} />
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {/* Today's Progress */}
      <div className="card">
        <div className="collapsible-header" onClick={() => setProgressOpen(o => !o)}>
          <h2 style={{ margin: 0 }}>Today's Progress</h2>
          <span className="collapse-arrow">{progressOpen ? '▲' : '▼'}</span>
        </div>
        {progressOpen && (
          <div style={{ marginTop: 12 }}>
            <div className="plan-bar" style={{ position: 'relative', height: 20, borderRadius: 6, overflow: 'hidden', background: 'var(--border)', marginBottom: 8 }}>
              <div className="plan-bar-fill" style={{ width: `${eatenPct}%`, height: '100%', background: 'var(--good)', position: 'absolute', left: 0, top: 0 }} />
              <div className="plan-bar-planned" style={{ width: `${plannedPct}%`, height: '100%', background: '#8b5cf6', position: 'absolute', left: `${eatenPct}%`, top: 0 }} />
              {/* Time marker */}
              <div className="plan-bar-time" style={{ position: 'absolute', left: `${timePct}%`, top: 0, bottom: 0, width: 2, background: '#3b82f6', zIndex: 2 }} />
              {/* Goal marker at right edge (100%) */}
              <div className="plan-bar-goal" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, background: '#f97316', zIndex: 2 }} />
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: 'var(--good)' }}>{Math.round(eaten)}g eaten</span>
              {' + '}
              <span style={{ color: '#8b5cf6' }}>{Math.round(planned)}g planned</span>
              {' + '}
              <span>{Math.round(gap)}g gap</span>
              {' | Goal: '}
              <strong>{Math.round(proteinGoal)}g</strong>
            </div>
            <div className="field">
              <label>Today's plan</label>
              <textarea
                placeholder="What are you planning to eat today?"
                value={planText}
                rows={3}
                onChange={e => {
                  setPlanText(e.target.value)
                  localStorage.setItem('food-tracker-plan-text', e.target.value)
                }}
              />
            </div>
            <div className="field" style={{ maxWidth: 200 }}>
              <label>Planned protein (g)</label>
              <input
                type="number"
                value={planProtein}
                min={0}
                onChange={e => {
                  const v = Number(e.target.value) || 0
                  setPlanProtein(v)
                  localStorage.setItem('food-tracker-plan-protein', String(v))
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Add Entry */}
      <div className="card">
        <div className="collapsible-header" onClick={() => setAddOpen(o => !o)}>
          <h2 style={{ margin: 0 }}>Add Entry</h2>
          <span className="collapse-arrow">{addOpen ? '▲' : '▼'}</span>
        </div>
        {addOpen && <AddEntrySimple onAdd={addEntry} defaultDate={today} />}
      </div>

      {/* Systems */}
      <div className="card">
        <div className="collapsible-header" onClick={() => setSystemsOpen(o => !o)}>
          <h2 style={{ margin: 0 }}>Success &amp; Failure Systems</h2>
          <span className="collapse-arrow">{systemsOpen ? '▲' : '▼'}</span>
        </div>
        {systemsOpen && (
          <div style={{ marginTop: 12 }}>
            {systemsText.trim() ? (
              <pre className="systems-content">{systemsText}</pre>
            ) : (
              <div className="muted">
                No systems defined yet. Add your success and failure systems to <code>systems.md</code> in your folder.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Weekly Log */}
      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Weekly Log</h2>
        {weeks.length === 0 ? (
          <div className="empty">No entries yet.</div>
        ) : weeks.map(([weekKey, weekEntries]) => {
          const sun = new Date(weekKey + 'T00:00:00')
          const sat = new Date(sun)
          sat.setDate(sun.getDate() + 6)
          const isExpanded = expandedWeeks.has(weekKey)
          const dayCount = new Set(weekEntries.map(e => e.Date)).size
          const avgProtein = weekEntries.reduce((s, e) => s + num(e['Protein (g)']), 0) / dayCount
          return (
            <div key={weekKey} style={{ marginBottom: 4 }}>
              <div className="week-header" onClick={() => toggleWeek(weekKey)}>
                <span><strong>{formatWeekLabel(sun, sat)}</strong></span>
                <span className="muted">{dayCount} day{dayCount !== 1 ? 's' : ''} | avg {Math.round(avgProtein)}g/day</span>
                <span className="collapse-arrow">{isExpanded ? '▲' : '▼'}</span>
              </div>
              {isExpanded && weekEntries.map((e, i) => (
                <div key={i} className="entry-row">
                  <span className="entry-row-date">{e.Date}</span>
                  <div className="entry-row-details">
                    <span className="entry-row-meal">{e.Meal}</span>
                    <span className="entry-row-protein"><strong>{e['Protein (g)']}</strong>g</span>
                    <button
                      className="icon-btn"
                      title="Delete"
                      onClick={() => deleteEntry(entries.indexOf(e))}
                    >🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AddEntrySimple({ onAdd, defaultDate }) {
  const [date, setDate] = useState(defaultDate)
  const [meal, setMeal] = useState('')
  const [protein, setProtein] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { setDate(defaultDate) }, [defaultDate])

  const estimate = async () => {
    if (!meal.trim()) return
    setBusy(true); setErr('')
    try {
      const result = await llm.estimateNutrition(meal, {})
      setProtein(String(result.protein_g ?? ''))
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!meal.trim()) return
    await onAdd({
      Date: date,
      Meal: meal.trim(),
      'Protein (g)': protein || '0',
    })
    setMeal(''); setProtein(''); setErr('')
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row">
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Meal</label>
        <input
          type="text"
          placeholder="e.g. 2 eggs, Greek yogurt, protein shake"
          value={meal}
          onChange={e => setMeal(e.target.value)}
        />
      </div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Protein (g)</label>
          <input
            type="number"
            value={protein}
            min={0}
            onChange={e => setProtein(e.target.value)}
          />
        </div>
        <button className="btn btn-secondary" onClick={estimate} disabled={busy || !meal.trim()} style={{ marginBottom: 0 }}>
          {busy ? <><span className="spinner" />Estimating…</> : '✨ Estimate with LLM'}
        </button>
      </div>
      {err && <div className="banner error">{err}</div>}
      <div style={{ marginTop: 8 }}>
        <button className="btn" onClick={save} disabled={!meal.trim()}>Save</button>
      </div>
    </div>
  )
}

export function ModePill({ mode, setMode }) {
  return (
    <div className="mode-pill">
      <button
        className={`mode-pill-btn ${mode === 'simple' ? 'active' : ''}`}
        onClick={() => setMode('simple')}
      >Simple</button>
      <button
        className={`mode-pill-btn ${mode === 'advanced' ? 'active' : ''}`}
        onClick={() => setMode('advanced')}
      >Advanced</button>
    </div>
  )
}
