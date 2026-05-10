// Helpers for splitting entry data across one file per month.

export function currentMonthKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function monthKeyOf(dateLike) {
  if (!dateLike) return currentMonthKey()
  const s = String(dateLike)
  // "YYYY-MM-DD" or "YYYY-MM" fast path
  const m = s.match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return currentMonthKey()
  return currentMonthKey(d)
}

export function entryFileName(prefix, monthKey) {
  return `${prefix}-${monthKey}.md`
}

export async function listMonthFiles(storage, prefix) {
  const names = await storage.listFiles().catch(() => [])
  const rx = new RegExp(`^${prefix}-(\\d{4}-\\d{2})\\.md$`)
  return names
    .map(name => { const m = rx.exec(name); return m ? { name, monthKey: m[1] } : null })
    .filter(Boolean)
    .sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1)) // newest first
}

export function groupByMonth(entries, getDate = e => e.Date) {
  const buckets = new Map()
  for (const e of entries) {
    const key = monthKeyOf(getDate(e))
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(e)
  }
  return buckets
}
