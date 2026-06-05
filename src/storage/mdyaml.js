import { encode, decode } from '@toon-format/toon'
import { parseTable, rowsToObjects } from './markdown.js'

export function readEntries(content, expectedHeaders) {
  if (!content || !content.trim()) return { meta: {}, rows: [] }

  // Try TOON first
  try {
    // TOON usually doesn't start with ---
    if (!content.trim().startsWith('---')) {
      const data = decode(content)
      if (data && (data.meta || data.rows)) {
        return {
          meta: data.meta || {},
          rows: data.rows || []
        }
      }
    }
  } catch {
    // not TOON
  }

  // Fallback to MD/YAML
  const { meta, body } = parseFrontmatter(content)
  const { headers, rows } = parseTable(body, expectedHeaders)
  if (!headers.length) return { meta, rows: [] }
  return { meta, rows: rowsToObjects(headers, rows) }
}

export function writeEntries(originalContent, headers, entries, metaOverrides = {}) {
  // We always write in TOON format now.
  let meta = {}
  try {
    const existing = readEntries(originalContent, headers)
    meta = existing.meta || {}
  } catch {
    // ignore
  }

  meta = {
    ...meta,
    ...metaOverrides,
    columns: headers
  }

  return encode({
    meta,
    rows: entries
  })
}

// --- Restored MD/YAML helpers for migration ---

function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return { meta: {}, body: text || '' }
  const rest = text.slice(3)
  const endMatch = rest.match(/\n---\s*(\n|$)/)
  if (!endMatch) return { meta: {}, body: text }
  const yaml = rest.slice(0, endMatch.index)
  const body = rest.slice(endMatch.index + endMatch[0].length)
  return { meta: parseYaml(yaml), body }
}

function parseYaml(text) {
  const meta = {}
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue }
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) { i++; continue }
    const key = m[1]
    const val = m[2].trim()
    if (val) {
      meta[key] = coerce(val)
      i++
    } else {
      const list = []
      i++
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        list.push(coerce(lines[i].replace(/^\s*-\s+/, '').trim()))
        i++
      }
      meta[key] = list
    }
  }
  return meta
}

function coerce(s) {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}
