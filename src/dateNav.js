// Date helpers for the tracker's day navigator (issue #57).
//
// All arithmetic goes through Date.UTC rather than the local-time Date
// constructor. A local-time `new Date(y, m, d)` lands on midnight, which is the
// exact instant a DST transition can remove or repeat, so adding 86400000 ms to
// it can yield the same calendar day twice or skip one. Doing the arithmetic in
// UTC and formatting with the UTC getters keeps a "day" exactly 24 hours wide,
// which is what a YYYY-MM-DD string means here.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = n => String(n).padStart(2, '0')

// Today in the user's local calendar, as YYYY-MM-DD.
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1) return false
  // Round-trip through UTC so 2026-02-30 is rejected rather than rolling over.
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// Moves a YYYY-MM-DD string by whole days. Invalid input is returned unchanged
// so a bad value from storage cannot crash the view.
export function shiftDate(dateStr, days) {
  if (!isValidDateStr(dateStr)) return dateStr
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

// "Today" / "Yesterday" for the two days people actually name, and an
// unambiguous weekday + date for anything older.
export function formatDayLabel(dateStr, today = todayStr()) {
  if (!isValidDateStr(dateStr)) return dateStr
  if (dateStr === today) return 'Today'
  if (dateStr === shiftDate(today, -1)) return 'Yesterday'
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${WEEKDAYS[dt.getUTCDay()]}, ${d} ${MONTHS[dt.getUTCMonth()]}`
}

// Possessive form for headings: "Today's Progress" reads better than
// "Today Progress", and so does "Mon, 1 Sep's" -> "Mon, 1 Sep".
export function dayHeading(dateStr, today = todayStr()) {
  const label = formatDayLabel(dateStr, today)
  return label === 'Today' || label === 'Yesterday' ? `${label}'s` : label
}

// Natural time phrase for sentence use: "today", "yesterday", or "on Mon, 31 Aug".
// Keeps prose readable instead of the "logged on Yesterday" that naive
// interpolation of the label produces.
export function dayPhrase(dateStr, today = todayStr()) {
  const label = formatDayLabel(dateStr, today)
  if (label === 'Today') return 'today'
  if (label === 'Yesterday') return 'yesterday'
  return `on ${label}`
}

// The navigator never goes into the future: logging food for a day that has not
// happened corrupts the day's totals, and the coach reads those totals as fact.
export function canGoForward(dateStr, today = todayStr()) {
  return isValidDateStr(dateStr) && dateStr < today
}

export function clampToToday(dateStr, today = todayStr()) {
  if (!isValidDateStr(dateStr)) return today
  return dateStr > today ? today : dateStr
}
