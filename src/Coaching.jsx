import { useCallback, useEffect, useRef, useState } from 'react'
import * as llm from './llm.js'

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
export function useCoaching({ storageReady, entries, systemsText = '', proteinGoal }) {
  const [coaching, setCoaching] = useState(null)
  const coachAbortRef = useRef(null)
  const coachedOnLoadRef = useRef(false)

  const requestCoaching = useCallback((lastMeal = '', lastProteinLogged = '') => {
    if (!llm.isReady()) return
    coachAbortRef.current?.abort()
    const ctrl = new AbortController()
    coachAbortRef.current = ctrl

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const recentEntriesText = (entries || [])
      .filter(e => e.Date && e.Date >= cutoffStr)
      .slice(-200)
      .map(e => `${e.Date} | ${e['Protein (g)'] || 0}g | ${e.Meal || ''}`)
      .join('\n')

    setCoaching(null)
    llm.getCoaching({
      recentEntriesText,
      systemsText,
      proteinGoal,
      lastMeal,
      lastProteinLogged,
      signal: ctrl.signal,
    })
      .then(text => { if (!ctrl.signal.aborted) setCoaching(text || null) })
      .catch(() => { /* silent */ })
  }, [entries, systemsText, proteinGoal])

  useEffect(() => {
    if (coachedOnLoadRef.current) return
    if (!storageReady) return
    if (!llm.isReady()) return
    if ((entries?.length ?? 0) === 0 && !systemsText.trim()) return
    coachedOnLoadRef.current = true
    requestCoaching()
  }, [storageReady, entries?.length, systemsText, requestCoaching])

  useEffect(() => () => coachAbortRef.current?.abort(), [])

  return {
    coaching,
    setCoaching,
    requestCoaching,
  }
}
