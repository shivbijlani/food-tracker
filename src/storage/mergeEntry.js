/**
 * Merge a new entry into the existing list.
 *
 * Mode controls which fields are merged (legacy).
 * We no longer merge entries. Every log action creates a separate row.
 */
export function mergeEntry(entries, entry) {
  return [entry, ...entries]
}

/** Replace the entry at index `idx` with `entry`. */
export function updateEntryAt(entries, idx, entry) {
  if (idx < 0 || idx >= entries.length) return entries
  const next = entries.slice()
  next[idx] = entry
  return next
}
