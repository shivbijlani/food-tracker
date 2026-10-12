import { readEntries, writeEntries } from './mdyaml.js'
import { DAILY_LOG_HEADERS, PROTEIN_LOG_HEADERS } from './markdown.js'
import { ToolError } from './tools.js'

export function mergeLogSnapshots(baseContent, localContent, remoteContent, mode) {
  if (localContent === baseContent || localContent == null) return remoteContent
  if (remoteContent === baseContent || localContent === remoteContent) return localContent
  const headers = mode === 'simple' ? PROTEIN_LOG_HEADERS : DAILY_LOG_HEADERS
  const base = readEntries(baseContent || '', headers)
  const local = readEntries(localContent || '', headers)
  const remote = readEntries(remoteContent || '', headers)
  const byId = rows => new Map(rows.map(r => [r.Id, r]))
  const [b, l, r] = [base.rows, local.rows, remote.rows].map(byId)
  const key = row => row ? JSON.stringify(headers.map(h => row[h] || '')) : null
  const rows = []
  for (const id of new Set([...l.keys(), ...r.keys(), ...b.keys()])) {
    const before = b.get(id), left = l.get(id), right = r.get(id)
    const localChanged = key(left) !== key(before)
    const remoteChanged = key(right) !== key(before)
    if (localChanged && remoteChanged && key(left) !== key(right)) {
      throw new ToolError('SYNC_CONFLICT', 'The same food entry changed on both devices. Resolve the conflict before syncing.')
    }
    const winner = localChanged ? left : right
    if (winner) rows.push(winner)
  }
  rows.sort((a, b) => b.Date.localeCompare(a.Date))
  const operations = [...new Set([...(remote.meta.foodOperations || []), ...(local.meta.foodOperations || [])])]
  return writeEntries(remoteContent || localContent || '', headers, rows, {
    ...remote.meta, kind: 'entries', mode, foodOperations: operations,
  })
}
