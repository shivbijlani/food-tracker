// Entry helpers.
//
// We used to merge entries sharing Date+Meal into a single row to keep the log
// compact, but that made individual items impossible to edit (a "Breakfast"
// row could be 5 foods summed together). Each log action now creates its own
// row; the per-row ✏️ edit UI in EntryRow / SimpleEntryRow handles correction.

export function identifyEntries(entries) {
  const occurrences = new Map()
  return entries.map(entry => {
    if (entry.Id) return entry
    // Content + occurrence gives identical legacy rows distinct, reproducible
    // identities without writing a backfill during a read.
    const content = JSON.stringify(Object.keys(entry).filter(k => k !== 'Id' && entry[k] !== '').sort().map(k => [k, entry[k]]))
    const occurrence = occurrences.get(content) || 0
    occurrences.set(content, occurrence + 1)
    return { ...entry, Id: `legacy:${encodeURIComponent(content)}:${occurrence}` }
  })
}

export function mergeEntry(entries, entry /*, mode */) {
  const incoming = { ...entry, Id: entry.Id || crypto.randomUUID() }
  if (entries.some(e => e.Id === incoming.Id)) return entries
  return [incoming, ...identifyEntries(entries)]
}

export function addLogEntries(entries, incoming) {
  return incoming.reduce((next, entry) => mergeEntry(next, entry), entries)
}

/** Replace the entry at index `idx` with `entry`. */
export function updateEntryAt(entries, idx, entry) {
  if (idx < 0 || idx >= entries.length) return entries
  const next = entries.slice()
  next[idx] = { ...entry, Id: entries[idx].Id || identifyEntries(entries)[idx].Id }
  return next
}
