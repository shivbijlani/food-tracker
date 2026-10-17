// Render assertions for the Log view's per-meal section (issue #58).
//
// The acceptance criteria for that issue are visual — "each meal shows a
// compact summary; details expand below" and "a copy button puts the meal's
// eaten items on the clipboard". Unit-testing the formatting functions alone
// would leave the wiring unverified, which is exactly where a UI change breaks.
// react-dom/server is enough to assert structure without adding a DOM harness.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MealSection, CopyButton } from './MealSection.jsx'
import { groupByMeal } from './mealSummary.js'

const entry = (over = {}) => ({
  Date: '2026-06-22',
  Meal: 'Lunch',
  'Food Description': 'Chicken salad',
  Calories: 400,
  'Protein (g)': 30,
  'Calcium (mg)': 100,
  'Veg Servings': 1,
  ...over,
})

const renderMeal = (entries, props = {}) => {
  const group = groupByMeal(entries)[0]
  return renderToStaticMarkup(
    <MealSection {...group} date="2026-06-22" {...props}>
      <div className="entry">{group.entries[0]['Food Description']}</div>
    </MealSection>,
  )
}

describe('MealSection', () => {
  it('renders a collapsible section with the meal name in the always-visible summary', () => {
    const html = renderMeal([entry()])
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('Lunch')
  })

  it('shows the condensed totals on the summary line, not hidden in the details', () => {
    const html = renderMeal([entry(), entry({ Calories: 100, 'Protein (g)': 5 })])
    const summary = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'))
    expect(summary).toContain('2 items')
    expect(summary).toContain('500 kcal')
    expect(summary).toContain('35g pro')
  })

  it('puts the entry details below the summary, not inside it', () => {
    const html = renderMeal([entry()])
    expect(html.indexOf('</summary>')).toBeLessThan(html.indexOf('class="entry"'))
  })

  it('is collapsed by default and open only when asked', () => {
    expect(renderMeal([entry()])).not.toContain('<details class="meal-section" open')
    expect(renderMeal([entry()], { defaultOpen: true })).toContain('open')
  })

  it('offers a copy action naming the meal', () => {
    expect(renderMeal([entry()])).toContain('Copy lunch')
  })

  it('renders whatever entry rows it is given', () => {
    const html = renderMeal([entry()])
    expect(html).toContain('Chicken salad')
  })
})

describe('CopyButton', () => {
  it('renders its label before anything is copied', () => {
    expect(renderToStaticMarkup(<CopyButton getText={() => 'x'} label="Copy day" />)).toContain('Copy day')
  })

  it('is a plain button so it never submits a form', () => {
    expect(renderToStaticMarkup(<CopyButton getText={() => 'x' } />)).toContain('type="button"')
  })
})
