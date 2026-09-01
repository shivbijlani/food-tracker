import { useState } from 'react'
import { formatMealSummary, mealToText, copyText, handleCopyClick } from './mealSummary.js'

/**
 * A copy button that reports what happened.
 *
 * Copying can fail silently — permission denied, or no async clipboard at all
 * on a plain-http origin (which is how this app is reached from a phone on the
 * LAN). A button that looks like it worked is worse than one that admits it
 * did not, because the user pastes stale clipboard content and blames the
 * other app.
 */
export function CopyButton({ getText, label = 'Copy', title, onCopy = copyText }) {
  const [state, setState] = useState('idle')

  const click = async (ev) => {
    await handleCopyClick(ev, { getText, onCopy, setState })
    setTimeout(() => setState('idle'), 1800)
  }

  return (
    <button
      type="button"
      className="btn btn-secondary copy-btn"
      onClick={click}
      title={title || 'Copy to clipboard'}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  )
}

/**
 * One meal inside a day (issue #58): a condensed summary line that is always
 * visible, with the detail rows and their edit controls collapsed underneath.
 *
 * The entry rows come in as children so this stays a presentational shell that
 * can be rendered and asserted on without dragging in the whole app.
 */
export function MealSection({ meal, entries, totals, date, defaultOpen, children, onCopy }) {
  return (
    <details className="meal-section" open={defaultOpen}>
      <summary className="meal-summary">
        <span className="meal-summary-name">{meal}</span>
        <span className="meal-summary-totals">{formatMealSummary(totals)}</span>
      </summary>
      <div className="meal-actions">
        <CopyButton
          getText={() => mealToText({ meal, entries, totals }, date)}
          label={`Copy ${meal.toLowerCase()}`}
          title={`Copy this ${meal.toLowerCase()} as text`}
          onCopy={onCopy}
        />
      </div>
      {children}
    </details>
  )
}
