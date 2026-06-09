// Generic markdown-table-sections codec.
//
// Turns a planner-style markdown file (## sections containing pipe tables) into
// a set of *records* keyed by the first-column id, plus a "frame" that captures
// every non-row line (headings, separators, blank lines, the Priorities ordered
// list, arbitrary prose) so the file can be reconstructed faithfully.
//
// This codec is declarative and pure — it has no app knowledge beyond "tables
// have an id in column 0" — so the exact same instance runs in the service
// worker and on the main thread.
//
// Record shape: { section, raw }  (raw = the full original row line)
// Record id:    numeric/leading token of column 0, e.g. "70" from
//               "| 70,[123](url) | ... |"  -> id "70". Falls back to the whole
//               trimmed first cell when there is no leading number.
//
// Frame: the file text with each data row replaced by a marker
//        \u0000ROW:<id>\u0000, plus per-section insertion anchors so rows added
//        on another device land under the right heading.

const ROW_MARK = (id) => `\u0000ROW:${id}\u0000`
// eslint-disable-next-line no-control-regex -- NUL is our intentional, collision-free row sentinel
const ROW_MARK_RE = /\u0000ROW:([^\u0000]+)\u0000/

// The reserved record id under which the frame is versioned, so structural /
// Priorities-list edits merge by last-write-wins like any other record.
export const FRAME_ID = '__frame__'

function idOfFirstCell(cell) {
  const t = cell.trim()
  const m = t.match(/^(\d+)/)
  return m ? m[1] : t
}

function isSeparatorRow(line) {
  // | --- | --- | ...   (table header underline)
  return /^\s*\|?[\s|:-]+\|[\s|:-]*$/.test(line) && line.includes('-')
}

function isDataRow(line) {
  const t = line.trim()
  if (!t.startsWith('|')) return false
  if (isSeparatorRow(line)) return false
  const cells = t.split('|').slice(1, -1).map(c => c.trim())
  if (cells.length === 0) return false
  // Skip header rows like "| ID | ... |".
  if (cells[0] === 'ID' || cells[0] === '#' || cells[0] === '') return false
  return true
}

/**
 * Parse markdown into { records, frame }.
 *   records: { [id]: { section, raw } }
 *   frame:   string with rows replaced by markers (stored as the FRAME_ID record)
 *
 * `opts.idFn(cells)` overrides the default id derivation (leading digits of
 * column 0). Use this for files whose first column isn't a unique id — e.g.
 * food-tracker entries files where column 0 is a Date repeated across many
 * rows on the same day.
 */
export function parse(content, opts = {}) {
  const text = content ?? ''
  const lines = text.split('\n')
  const records = {}
  const frameLines = []
  let currentSection = null
  const idFn = opts.idFn || ((cells) => idOfFirstCell(cells[0] ?? ''))

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) {
      currentSection = line.replace(/^##\s+/, '').trim()
      frameLines.push(line)
      continue
    }
    if (isDataRow(line)) {
      // Skip the column-header row — the line immediately followed by a
      // separator. Without this, headers like "| Date | Meal | ... |" would be
      // treated as data when the first cell isn't one of the known sentinels
      // ("ID" / "#" / "").
      const next = lines[i + 1]
      if (next && isSeparatorRow(next)) {
        frameLines.push(line)
        continue
      }
      const cells = line.trim().split('|').slice(1, -1).map(c => c.trim())
      const id = idFn(cells)
      // If two rows resolve to the same id, keep the first; still emit a
      // marker so the second survives as literal text. With a well-chosen
      // idFn (one that captures per-row uniqueness) this branch shouldn't fire.
      if (!(id in records)) {
        records[id] = { section: currentSection, raw: line }
        frameLines.push(ROW_MARK(id))
      } else {
        frameLines.push(line)
      }
      continue
    }
    frameLines.push(line)
  }

  return { records, frame: frameLines.join('\n') }
}

// Find, per section, the index just after the table separator — the natural
// place to insert a brand-new row that arrived from another device.
function sectionInsertPoints(frameLines) {
  const points = new Map() // section -> insert index (into frameLines)
  let section = null
  for (let i = 0; i < frameLines.length; i++) {
    const line = frameLines[i]
    if (line.startsWith('## ')) {
      section = line.replace(/^##\s+/, '').trim()
      continue
    }
    if (section && !points.has(section) && isSeparatorRow(line)) {
      points.set(section, i + 1)
    }
  }
  return points
}

/**
 * Rebuild markdown from { records, frame }.
 * - Markers for ids that still have an alive record are replaced by that
 *   record's raw line.
 * - Markers for ids with no record (deleted/merged away) are dropped.
 * - Records whose id has no marker in the frame (added on another device) are
 *   inserted at their section's anchor, or appended if the section is unknown.
 */
export function serialize({ records, frame }) {
  const frameLines = (frame ?? '').split('\n')
  const seen = new Set()
  const out = []

  for (const line of frameLines) {
    const m = line.match(ROW_MARK_RE)
    if (!m) { out.push(line); continue }
    const id = m[1]
    seen.add(id)
    const rec = records[id]
    if (rec) out.push(rec.raw) // dropped entirely if no record (deleted)
  }

  // Insert records that weren't represented by a marker in the frame.
  const extras = Object.keys(records).filter(id => !seen.has(id))
  if (extras.length) {
    const points = sectionInsertPoints(out)
    // Apply inserts from the bottom up so earlier indices stay valid.
    const inserts = []
    for (const id of extras) {
      const rec = records[id]
      const at = (rec.section && points.get(rec.section))
      inserts.push({ at: at == null ? out.length : at, raw: rec.raw })
    }
    inserts.sort((a, b) => b.at - a.at)
    for (const { at, raw } of inserts) out.splice(at, 0, raw)
  }

  return out.join('\n')
}

export const mdTableCodec = { parse, serialize, FRAME_ID }

/**
 * Factory for a codec instance with custom row-id derivation. Use this for
 * files where the first column isn't a unique row identifier (e.g.
 * food-tracker entries, where many rows share the same Date).
 *
 *   const codec = makeMdTableCodec({
 *     idFn: (cells) => cells[cells.length - 1]   // last column holds the Id
 *   })
 *   reconcileRecord(provider, 'entries-2026-06.md', codec)
 *
 * `cells` is the array of trimmed cell values for the row, in column order.
 */
export function makeMdTableCodec({ idFn } = {}) {
  return {
    parse: (content) => parse(content, { idFn }),
    serialize,
    FRAME_ID,
  }
}
