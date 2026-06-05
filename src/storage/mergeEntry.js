// Entry helpers.
//
// We used to merge entries sharing Date+Meal into a single row to keep the log
// compact, but that made individual items impossible to edit (a "Breakfast"
// row could be 5 foods summed together). Each log action now creates its own
// row; the per-row ✏️ edit UI in EntryRow / SimpleEntryRow handles correction.

export function mergeEntry(entries, entry /*, mode */) {
  return [entry, ...entries]
}

/** Replace the entry at index `idx` with `entry`. */
export function updateEntryAt(entries, idx, entry) {
  if (idx < 0 || idx >= entries.length) return entries
  const next = entries.slice()
  next[idx] = entry
  return next
}
