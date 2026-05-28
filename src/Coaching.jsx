import { useCallback, useEffect, useRef, useState } from 'react'
import * as llm from './llm.js'

function num(v) { const n = Number(v); return isFinite(n) ? n : 0 }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Card that displays AI coaching text. Hidden entirely while the LLM is
 * working — animates in (via the .coaching-card CSS keyframes) only once
 * there's actual text to show.
 */
export function CoachingCard({ text, onDismiss }) {
  if (!text) return null
  return (
    <div className="coaching-card" role="status" aria-live="polite">
      <div className="coaching-icon" aria-hidden="true">💬</div>
      <div className="coaching-body">
        <span>{text}</span>
      </div>
      <button
        type="button"
        className="icon-btn coaching-dismiss"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss coaching"
      >×</button>
    </div>
  )
}

/**
 * Shared coaching state hook. Mirrors the original SimpleMode behaviour so
 * both Simple and Advanced modes show the same card. Pass the same `entries`
 * structure used by the rest of the app (objects with Date / Meal /
 * Protein (g)). `systemsText` is optional and only present in Simple mode.
 */
export function useCoaching({ storageReady, entries, systemsText = '', proteinGoal, today, goals = [], frequentFoods = [] }) {
  const [coaching, setCoaching] = useState(null)
  const coachAbortRef = useRef(null)
  const coachedOnLoadRef = useRef(false)

  const requestCoaching = useCallback((lastMeal = '', lastProteinLogged = '', mealEntries = null) => {
    if (!llm.isReady()) return
    coachAbortRef.current?.abort()
    const ctrl = new AbortController()
    coachAbortRef.current = ctrl

    const todayDate = today || todayStr()
    const todayEntries = (entries || []).filter(e => e.Date === todayDate)

    // Today's meals formatted for the prompt
    const todayEntriesText = todayEntries
      .map(e => `${e.Meal || '?'} | ${e['Food Description'] || '(no description)'} | ${e['Protein (g)'] || 0}g protein | ${e.Calories || 0} kcal`)
      .join('\n')

    // Today's running totals
    const todayTotals = todayEntries.reduce((acc, e) => ({
      calories: acc.calories + num(e.Calories),
      protein: acc.protein + num(e['Protein (g)']),
      calcium: acc.calcium + num(e['Calcium (mg)']),
      veg: Math.round((acc.veg + num(e['Veg Servings'])) * 10) / 10,
      omega3: acc.omega3 || e['Omega-3'] === 'Y',
    }), { calories: 0, protein: 0, calcium: 0, veg: 0, omega3: false })

    // Goals as a single line
    const goalsText = goals
      .filter(g => g.Nutrient && g.Target)
      .map(g => `${g.Nutrient} ${g.Target}`)
      .join(', ')

    // Top frequent foods with nutrition (for suggestions)
    const frequentFoodsText = frequentFoods
      .slice(0, 15)
      .filter(f => f.name && (f.protein_g || f.calories))
      .map(f => {
        const parts = [f.name]
        if (f.protein_g) parts.push(`${f.protein_g}g protein`)
        if (f.calories) parts.push(`${f.calories} kcal`)
        return parts.join(': ')
      })
      .join('\n')

    // Recent history for pattern context (exclude today — already in todayEntriesText)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const recentEntriesText = (entries || [])
      .filter(e => e.Date && e.Date >= cutoffStr && e.Date < todayDate)
      .slice(-100)
      .map(e => `${e.Date} | ${e.Meal || ''} | ${e['Food Description'] || ''} | ${e['Protein (g)'] || 0}g protein`)
      .join('\n')

    // Build a summary line for the meal that was just logged.
    // If multiple items were tracked in the same meal session, summarise
    // the whole meal rather than just the last item.
    let lastMealLine = ''
    if (lastMeal) {
      const items = mealEntries && mealEntries.length > 0 ? mealEntries : null
      if (items && items.length > 1) {
        const totalPro = Math.round(items.reduce((s, e) => s + num(e['Protein (g)']), 0))
        const totalCal = Math.round(items.reduce((s, e) => s + num(e.Calories), 0))
        lastMealLine = `${lastMeal} complete — ${items.length} items, ${totalPro}g protein, ${totalCal} kcal total`
      } else {
        lastMealLine = `${lastMeal} — ${lastProteinLogged}g protein`
      }
    }

    setCoaching(null)
    llm.getCoaching({
      recentEntriesText,
      systemsText,
      proteinGoal,
      lastMealLine,
      todayEntriesText,
      todayTotals: todayEntries.length > 0 ? todayTotals : null,
      goalsText,
      frequentFoodsText,
      signal: ctrl.signal,
    })
      .then(text => { if (!ctrl.signal.aborted) setCoaching(text || null) })
      .catch(() => { /* silent */ })
  }, [entries, systemsText, proteinGoal, today, goals, frequentFoods])

  useEffect(() => {
    if (coachedOnLoadRef.current) return
    if (!storageReady) return
    if (!llm.isReady()) return
    // Only fire on load if there are entries TODAY — avoids the LLM seeing
    // yesterday's meals and commenting on them as if they just happened.
    const todayDate = today || todayStr()
    const hasTodayEntries = (entries || []).some(e => e.Date === todayDate)
    if (!hasTodayEntries && !systemsText.trim()) return
    coachedOnLoadRef.current = true
    requestCoaching()
  }, [storageReady, entries?.length, systemsText, requestCoaching, today])

  useEffect(() => () => coachAbortRef.current?.abort(), [])

  return {
    coaching,
    setCoaching,
    requestCoaching,
  }
}
