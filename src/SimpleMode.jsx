import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { BRAND } from './branding.js'
import { storage, getEngine } from './storage/storage.js'
import { debounce } from './debounce.js'
import { StatusBadge } from './StatusBadge.jsx'
import { openSettings } from './SettingsButton.jsx'
import { Footer } from './Footer.jsx'
import { PROTEIN_LOG_HEADERS, GOALS_HEADERS, RECIPE_HEADERS } from './storage/markdown.js'
import { readEntries, writeEntries } from './storage/mdyaml.js'
import { currentMonthKey, entryFileName, listMonthFiles, groupByMonth } from './storage/monthly.js'
import { mergeEntry, updateEntryAt } from './storage/mergeEntry.js'
import {
  SUGGESTIONS_FILE,
  parseSuggestions,
  serializeSuggestions,
  upsertSuggestion,
  expandWithHalves,
  recipeServingsCount,
} from './storage/suggestions.js'
import { CoachingCard, useCoaching } from './Coaching.jsx'
import * as llm from './llm.js'
import { UpsellModal } from './UpsellModal.jsx'
import AutocompleteInput from './AutocompleteInput.jsx'

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

// Tiny markdown renderer — handles headers (# / ## / ###), bullets (- / *),
// bold (**…**), and paragraphs. Sufficient for systems.md content.
function renderInline(text) {
  const parts = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0, m, idx = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<strong key={`b${idx++}`}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownView({ text }) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let bullets = null
  const flushBullets = () => {
    if (bullets) { blocks.push(<ul key={`u${blocks.length}`}>{bullets}</ul>); bullets = null }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*$/.test(line)) { flushBullets(); continue }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushBullets()
      const level = h[1].length
      const Tag = `h${Math.min(level + 1, 6)}`
      blocks.push(<Tag key={`h${blocks.length}`}>{renderInline(h[2])}</Tag>)
      continue
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/)
    if (li) {
      if (!bullets) bullets = []
      bullets.push(<li key={`l${i}`}>{renderInline(li[1])}</li>)
      continue
    }
    flushBullets()
    blocks.push(<p key={`p${blocks.length}`}>{renderInline(line)}</p>)
  }
  flushBullets()
  return <div className="systems-content">{blocks}</div>
}

export default function SimpleMode({ storageReady, folderName, mode, setMode, storageProvider, syncStatus }) {
  const [entries, setEntries] = useState([])
  const [goals, setGoals] = useState([])
  const [recipes, setRecipes] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [systemsText, setSystemsText] = useState('')
  const [error, setError] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Collapsible panels
  const [progressOpen, setProgressOpen] = useState(true)
  const [addOpen, setAddOpen] = useState(true)
  const [systemsOpen, setSystemsOpen] = useState(false)

  // Plan fields (localStorage-backed)
  const [planText, setPlanText] = useState(() => localStorage.getItem('mealjot-plan-text') || '')
  const [planProtein, setPlanProtein] = useState(() => Number(localStorage.getItem('mealjot-plan-protein')) || 0)

  // Week expand state
  const [expandedWeeks, setExpandedWeeks] = useState(() => new Set([currentWeekKey()]))

  // Coaching — shared with App.jsx (advanced mode) via the useCoaching hook.

  const loadAll = useCallback(async () => {
    if (!storageReady) return
    try {
      const curKey = currentMonthKey()
      const curName = entryFileName('protein', curKey)
      const [logText, goalsText, sysText, recipesText, suggestionsText] = await Promise.all([
        storage.readFile(curName).catch(() => ''),
        storage.readFile('goals.md').catch(() => ''),
        storage.readFile('systems.md').catch(() => ''),
        storage.readFile('recipes.md').catch(() => ''),
        storage.readFile(SUGGESTIONS_FILE).catch(() => ''),
      ])
      const curRows = readEntries(logText, PROTEIN_LOG_HEADERS).rows
      setEntries(curRows)
      setGoals(readEntries(goalsText, GOALS_HEADERS).rows)
      setSystemsText(sysText)
      const recipeRows = readEntries(recipesText, RECIPE_HEADERS).rows
      setRecipes(recipeRows)
      setSuggestions(parseSuggestions(suggestionsText || ''))
      setError('')

      // Lazy-load history (for LogView).
      setLoadingHistory(true)
      const months = await listMonthFiles(storage, 'protein')
      const rest = months.filter(m => m.monthKey !== curKey)
      if (rest.length) {
        const texts = await Promise.all(rest.map(m => storage.readFile(m.name).catch(() => '')))
        const histRows = texts.flatMap(t => readEntries(t, PROTEIN_LOG_HEADERS).rows)
        setEntries(prev => {
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
  }, [storageReady])

  useEffect(() => { if (storageReady) loadAll() }, [storageReady, loadAll])

  // Re-read files whenever the sync engine pulls a remote update into the
  // local adapter (e.g. systems.md or a monthly log edited on another
  // device). Without this, the page would show stale content until a manual
  // reload. Debounced because the engine fires one `lastRemoteUpdate` per
  // file — a sync pulling 5 files would otherwise trigger 5 reloads.
  useEffect(() => {
    if (!storageReady) return
    const debouncedReload = debounce(() => loadAll(), 150)
    let unsub = () => {}
    try {
      const eng = getEngine()
      unsub = eng.subscribe((s) => {
        if (s?.lastRemoteUpdate) debouncedReload()
      })
    } catch { /* engine not ready */ }
    return () => {
      debouncedReload.cancel()
      unsub()
    }
  }, [storageReady, loadAll])

  const saveLog = async (newEntries) => {
    const sorted = [...newEntries].sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0))
    const buckets = groupByMonth(sorted)
    const existing = await listMonthFiles(storage, 'protein')
    for (const m of existing) {
      if (!buckets.has(m.monthKey)) {
        const orig = await storage.readFile(m.name).catch(() => '')
        await storage.writeFile(m.name, writeEntries(orig, PROTEIN_LOG_HEADERS, [], { kind: 'entries', mode: 'simple', period: m.monthKey }))
      }
    }
    for (const [key, rows] of buckets) {
      const name = entryFileName('protein', key)
      const original = await storage.readFile(name).catch(() => '')
      const next = writeEntries(original, PROTEIN_LOG_HEADERS, rows, { kind: 'entries', mode: 'simple', period: key })
      await storage.writeFile(name, next)
    }
    setEntries(sorted)
  }

  const addEntries = async (newEntries) => {
    let nextLog = entries
    for (const e of newEntries) {
      nextLog = mergeEntry(nextLog, e, 'simple')
    }
    await saveLog(nextLog)

    let nextSuggestions = suggestions
    for (const e of newEntries) {
      if (e?.Meal) {
        nextSuggestions = upsertSuggestion(nextSuggestions, {
          name: e.Meal,
          protein_g: e['Protein (g)'],
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
    await saveLog(updateEntryAt(entries, idx, entry))
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

  // Coaching — fires on load + after each save via the shared hook.
  const { coaching, setCoaching, requestCoaching } = useCoaching({
    storageReady,
    entries,
    systemsText,
    proteinGoal,
  })

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
        <h1 className="app-title">{BRAND.emoji} {BRAND.appName}</h1>
        <StatusBadge
          folderName={folderName}
          syncStatus={syncStatus}
          mode={mode}
          setMode={setMode}
          storageProvider={storageProvider}
        />
      </header>

      {error && <div className="banner error">{error}</div>}
      {loadingHistory && <div className="banner">Loading history…</div>}

      {/* Coaching tip — shown on load if LLM connected, refreshed after each save */}
      <CoachingCard text={coaching} onDismiss={() => setCoaching(null)} />

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
                  localStorage.setItem('mealjot-plan-text', e.target.value)
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
                  localStorage.setItem('mealjot-plan-protein', String(v))
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
        {addOpen && (
          <AddEntrySimple
            onAdd={addEntries}
            defaultDate={today}
            onAfterSave={requestCoaching}
            suggestions={suggestions}
            recipes={recipes}
          />
        )}
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
              <MarkdownView text={systemsText} />
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
              {isExpanded && weekEntries.map((e, i) => {
                const globalIdx = entries.indexOf(e)
                return (
                  <SimpleEntryRow
                    key={i}
                    entry={e}
                    onUpdate={(updated) => updateEntry(globalIdx, updated)}
                    onDelete={() => deleteEntry(globalIdx)}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
      <Footer />
    </div>
  )
}

function SimpleEntryRow({ entry, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry)

  if (editing) {
    const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
    const save = async () => { await onUpdate(draft); setEditing(false) }
    const cancel = () => { setDraft(entry); setEditing(false) }
    return (
      <div className="entry-row" style={{ background: 'rgba(0,0,0,0.04)', flexWrap: 'wrap', gap: 6, padding: 6 }}>
        <input type="date" value={draft.Date || ''} onChange={e => set('Date', e.target.value)} />
        <input
          value={draft.Meal || ''}
          onChange={e => set('Meal', e.target.value)}
          placeholder="meal/food"
          style={{ flex: 1, minWidth: 120 }}
        />
        <input
          type="number"
          value={draft['Protein (g)'] || 0}
          onChange={e => set('Protein (g)', e.target.value)}
          style={{ width: 60 }}
        />
        <button className="icon-btn" title="Save" onClick={save}>✓</button>
        <button className="icon-btn" title="Cancel" onClick={cancel}>✕</button>
      </div>
    )
  }

  return (
    <div className="entry-row">
      <span className="entry-row-date">{entry.Date}</span>
      <div className="entry-row-details">
        <span className="entry-row-meal">{entry.Meal}</span>
        <span className="entry-row-protein"><strong>{entry['Protein (g)']}</strong>g</span>
        {onUpdate && <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>✏️</button>}
        <button className="icon-btn" title="Delete" onClick={onDelete}>🗑</button>
      </div>
    </div>
  )
}

function AddEntrySimple({ onAdd, defaultDate, onAfterSave, suggestions: suggestionsCsv = [], recipes = [] }) {
  const [date, setDate] = useState(defaultDate)
  const [meal, setMeal] = useState('')
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const abortControllerRef = useRef(null)

  // Re-evaluate LLM readiness on each render — cheap (localStorage read).
  const llmReady = llm.isReady()

  useEffect(() => { setDate(defaultDate) }, [defaultDate])

  // Suggestions = suggestions.csv (food database) + recipes, with virtual
  // "Half X" variants for every item that has nutrition.
  const suggestions = useMemo(() => {
    let list = []
    for (const r of recipes) {
      if (!r.Recipe) continue
      const servings = recipeServingsCount(r)
      const perServing = (v) => {
        const n = Number(v)
        if (!isFinite(n) || n <= 0) return ''
        return String(Math.round((n / servings) * 10) / 10).replace(/\.0$/, '')
      }
      list = upsertSuggestion(list, {
        name: r.Recipe,
        protein_g: perServing(r['Protein (g)']),
        calories: perServing(r.Calories),
      })
    }
    for (const s of suggestionsCsv) {
      list = upsertSuggestion(list, s)
    }
    return expandWithHalves(list).map(s => ({
      name: s.name,
      protein: s.protein_g === '' ? null : num(s.protein_g),
      calories: s.calories === '' ? null : num(s.calories),
    }))
  }, [recipes, suggestionsCsv])

  const selectSuggestion = (s) => {
    setMeal(s.name)
    setItems([{
      id: Math.random().toString(36).slice(2),
      name: s.name,
      protein: s.protein != null ? String(s.protein) : '',
      loading: false,
    }])
  }

  const estimate = async () => {
    if (!meal.trim()) return
    let parts = meal.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.length === 1 && parts[0].includes(' and ')) {
      parts = parts[0].split(/\s+and\s+/i).map(p => p.trim()).filter(Boolean)
    }
    if (parts.length === 0) return

    if (abortControllerRef.current) abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()

    setBusy(true)
    setErr('')

    const isLlmReady = llm.isReady()
    const newItems = parts.map(name => ({
      id: Math.random().toString(36).slice(2),
      name,
      protein: '',
      loading: isLlmReady,
    }))
    setItems(newItems)

    if (!isLlmReady) {
      setErr('LLM_NOT_CONFIGURED')
      setBusy(false)
      return
    }

    try {
      await Promise.all(parts.map(async (part, i) => {
        try {
          const result = await llm.estimateNutrition(part, { recipes, signal: abortControllerRef.current.signal })
          setItems(prev => prev.map(item => (item.id === newItems[i].id && item.loading) ? { ...item, protein: String(result.protein_g ?? '0'), loading: false } : item))
        } catch (e) {
          if (e.name === 'AbortError') return
          setItems(prev => prev.map(item => (item.id === newItems[i].id && item.loading) ? { ...item, loading: false, err: e.message } : item))
          if (e.code === 'LLM_NOT_CONFIGURED') setErr('LLM_NOT_CONFIGURED')
        }
      }))
    } finally {
      if (!abortControllerRef.current.signal.aborted) {
        setBusy(false)
      }
    }
  }

  const save = async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort()
    const mealSnapshot = meal.trim()
    if (!mealSnapshot && items.length === 0) return

    const entriesToSave = items.length > 0
      ? items.map(it => ({ Date: date, Meal: it.name.trim(), 'Protein (g)': it.protein || '0' }))
      : [{ Date: date, Meal: mealSnapshot, 'Protein (g)': '0' }]

    await onAdd(entriesToSave)

    const totalProtein = entriesToSave.reduce((sum, e) => sum + num(e['Protein (g)']), 0)
    setMeal(''); setItems([]); setErr('')
    onAfterSave?.(mealSnapshot, totalProtein)
  }

  const estimateAndSave = async () => {
    if (!meal.trim()) return
    if (abortControllerRef.current) abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()

    setBusy(true); setErr('')
    const parts = meal.split(',').map(p => p.trim()).filter(Boolean)
    const newItems = parts.map(name => ({
      id: Math.random().toString(36).slice(2),
      name,
      protein: '',
      loading: true,
    }))
    setItems(newItems)

    try {
      const results = await Promise.all(parts.map(async (part, i) => {
        const result = await llm.estimateNutrition(part, { recipes, signal: abortControllerRef.current.signal })
        setItems(prev => prev.map(item => (item.id === newItems[i].id && item.loading) ? { ...item, protein: String(result.protein_g ?? '0'), loading: false } : item))
        return { Date: date, Meal: part, 'Protein (g)': String(result.protein_g ?? '0') }
      }))

      if (abortControllerRef.current.signal.aborted) return

      await onAdd(results)
      const totalProtein = results.reduce((sum, e) => sum + num(e['Protein (g)']), 0)
      setMeal(''); setItems([]); setErr('')
      onAfterSave?.(meal.trim(), totalProtein)
    } catch (e) {
      if (e.name === 'AbortError') return
      setErr(e.message)
      if (e.code === 'LLM_NOT_CONFIGURED') setErr('LLM_NOT_CONFIGURED')
    } finally {
      if (!abortControllerRef.current.signal.aborted) {
        setBusy(false)
      }
    }
  }

  const updateItem = (id, key, val) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [key]: val, loading: false, err: undefined } : it))
  }

  const removeItem = (id) => {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  const totalProtein = items.reduce((sum, it) => sum + num(it.protein), 0)

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row">
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Meal</label>
        <AutocompleteInput
          value={meal}
          onChange={setMeal}
          suggestions={suggestions}
          onSelect={selectSuggestion}
          placeholder="e.g. 2 eggs, Greek yogurt, protein shake"
          type="text"
        />
      </div>

      <UpsellModal isOpen={err === 'LLM_NOT_CONFIGURED'} onClose={() => setErr('')} />

      {items.length > 0 && (
        <div className="previews-container">
          <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
            <strong>Estimated items</strong>
            {busy && <span className="spinner" />}
          </div>
          {items.map(it => (
            <div key={it.id} className="simple-estimate-item">
               <div style={{ flex: 1 }}>
                 <div className="simple-estimate-item-header">
                    <input
                      value={it.name}
                      onChange={e => updateItem(it.id, 'name', e.target.value)}
                      className="simple-estimate-item-name-input"
                    />
                    <div className="flex gap-4">
                      <button className="icon-btn" onClick={() => {
                        if (abortControllerRef.current) abortControllerRef.current.abort()
                        onAdd([{ Date: date, Meal: it.name.trim(), 'Protein (g)': it.protein || '0' }])
                        onAfterSave?.(it.name.trim(), num(it.protein))
                        removeItem(it.id)
                      }} title="Save this item" style={{ minWidth: 0, minHeight: 0, padding: 4 }}>➕</button>
                      <button className="icon-btn" onClick={() => removeItem(it.id)} title="Remove" style={{ minWidth: 0, minHeight: 0, padding: 4 }}>🗑</button>
                    </div>
                 </div>
                 <div className="simple-estimate-item-body">
                    <div className="field" style={{ margin: 0 }}>
                       <input
                         type="number"
                         value={it.protein}
                         onChange={e => updateItem(it.id, 'protein', e.target.value)}
                         className="simple-estimate-item-protein-input"
                       />
                    </div>
                    <span className="muted">g protein</span>
                    {it.loading && <span className="spinner" />}
                 </div>
                 {it.err && <div className="banner error" style={{ margin: '4px 0 0', padding: '4px 8px', fontSize: 11 }}>{it.err}</div>}
               </div>
            </div>
          ))}
          <div className="flex justify-between items-center" style={{ marginTop: 8, padding: '0 4px' }}>
            <strong style={{ fontSize: 14 }}>Total: {Math.round(totalProtein)}g pro</strong>
            <button className="btn btn-secondary" onClick={() => setItems([])} style={{ padding: '4px 10px', fontSize: 12 }}>Discard all</button>
          </div>
        </div>
      )}

      {err && err !== 'LLM_NOT_CONFIGURED' && <div className="banner error">{err}</div>}

      {items.length === 0 && (
        <div className="protein-estimate-row" style={{ marginBottom: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={estimate}
            disabled={busy || !meal.trim()}
          >
            {busy ? <><span className="spinner" />Estimating…</> : '✨ Estimate'}
          </button>
        </div>
      )}

      <div className="add-entry-actions">
        {llmReady && items.length === 0 ? (
          <button className="btn" onClick={estimateAndSave} disabled={busy || !meal.trim()}>
            {busy ? <><span className="spinner" />Working…</> : '✨ Estimate & Save'}
          </button>
        ) : (
          <button className="btn" onClick={save} disabled={!meal.trim() && items.length === 0}>
            Save
          </button>
        )}
      </div>
    </div>
  )
}


