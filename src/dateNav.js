// Date navigation for the tracker view (issue #57).
//
// Kiley asked to select a past date and see that day's bars and food, and to
// be able to log to it. All of the date arithmetic lives here as pure
// functions so it can be tested without a DOM, and so the label on screen and
// the date written to storage can never disagree — they are derived from the
// same string.
//
// Dates are handled as plain `YYYY-MM-DD` strings throughout. Parsing them
// into `Date` objects is the standard way to get this wrong: `new Date('2026-09-01')`
// parses as UTC midnight, so in any negative-offset timezone (the app's users
// are in Seattle) it renders as the previous day. Everything below stays in
// string/number space for exactly that reason.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Today as `YYYY-MM-DD` in the *local* timezone. */
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1) return false
  return d <= daysInMonth(y, m)
}

function daysInMonth(year, month) {
  // month is 1-based. Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Move a `YYYY-MM-DD` string by whole days, staying in UTC so a DST boundary
 * can never add or drop a day. Returns the input unchanged if it is not a
 * valid date, so a bad value can never navigate the user somewhere arbitrary.
 */
export function shiftDate(dateStr, days) {
  if (!isValidDateStr(dateStr)) return dateStr
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + days * 86400000
  const dt = new Date(t)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** Whole days between two `YYYY-MM-DD` strings (b - a). */
export function daysBetween(a, b) {
  if (!isValidDateStr(a) || !isValidDateStr(b)) return 0
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Human label for the selected day: "Today", "Yesterday", otherwise
 * "Mon, Sep 1". Kept deliberately short — it sits in a single-line nav bar
 * next to the arrows on a phone.
 */
export function formatDateLabel(dateStr, today) {
  if (!isValidDateStr(dateStr)) return dateStr
  const delta = daysBetween(today, dateStr)
  if (delta === 0) return 'Today'
  if (delta === -1) return 'Yesterday'
  if (delta === 1) return 'Tomorrow'
  const [y, m, d] = dateStr.split('-').map(Number)
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const base = `${wd}, ${MONTHS[m - 1]} ${d}`
  // Only show the year when it isn't the current one, to keep the bar short.
  return y === Number(today.slice(0, 4)) ? base : `${base}, ${y}`
}

/**
 * Forward navigation stops at today. The tracker has only ever shown the
 * current day, so refusing to walk into empty future days removes nothing
 * that existed before — and an empty future day looks identical to a day you
 * forgot to log, which is a genuinely confusing thing to show someone.
 * Logging to a future date is still possible via the add-entry date field.
 */
export function canGoNext(dateStr, today) {
  return daysBetween(dateStr, today) > 0
}

export function canGoPrev() {
  return true
}

/** Entries logged on the given date, in their original order. */
export function entriesForDate(entries, date) {
  return (entries || []).filter(e => e && e.Date === date)
}

/**
 * Clamp a date coming from the native picker. The picker is bounded by `max`
 * in the markup, but a user can still type into it, so the value is clamped
 * here too rather than trusting the widget.
 */
export function clampDate(dateStr, today) {
  if (!isValidDateStr(dateStr)) return today
  return daysBetween(dateStr, today) < 0 ? today : dateStr
}
