// Minimal markdown + YAML-frontmatter helpers.
//
// File shape:
//   ---
//   schemaVersion: 1
//   kind: entries
//   mode: advanced
//   period: 2026-05
//   columns:
//     - Date
//     - Meal
//     ...
//   ---
//   # Title (optional)
//
//   | Date | Meal | ... |
//   |------|------|-----|
//   | ...  | ...  | ... |
//
// We only support the YAML subset we emit: scalar `key: value` and
// block-list values (`-` indented under a key).

import { parseTable, replaceFirstTable, rowsToObjects, objectsToRows, serializeTable } from './markdown.js'

const FENCE = /^---\s*$/m

export function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return { meta: {}, body: text || '' }
  const rest = text.slice(3)
  const endMatch = rest.match(/\n---\s*(\n|$)/)
  if (!endMatch) return { meta: {}, body: text }
  const yaml = rest.slice(0, endMatch.index)
  const body = rest.slice(endMatch.index + endMatch[0].length)
  return { meta: parseYaml(yaml), body }
}

export function serializeFrontmatter(meta, body) {
  return `---\n${stringifyYaml(meta)}---\n${body.startsWith('\n') ? body.slice(1) : body}`
}

// --- tiny YAML emitter/parser (only what we use) ---

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
      // block list/map: scan indented `- item` lines
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

function stringifyYaml(meta) {
  const lines = []
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`)
      for (const item of v) lines.push(`  - ${formatScalar(item)}`)
    } else {
      lines.push(`${k}: ${formatScalar(v)}`)
    }
  }
  return lines.join('\n') + '\n'
}

function coerce(s) {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  // strip wrapping quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function formatScalar(v) {
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = String(v)
  if (/[:#]/.test(s) || s.trim() !== s) return JSON.stringify(s)
  return s
}

// --- combined helpers: read a md+yaml file's table rows as objects ---

export function readEntries(content, expectedHeaders) {
  const { meta, body } = parseFrontmatter(content)
  const { headers, rows } = parseTable(body, expectedHeaders)
  if (!headers.length) return { meta, rows: [] }
  return { meta, rows: rowsToObjects(headers, rows) }
}

export function writeEntries(originalContent, headers, entries, metaOverrides = {}) {
  const { meta: existingMeta, body: existingBody } = parseFrontmatter(originalContent || '')
  const meta = {
    schemaVersion: 1,
    columns: headers,
    ...existingMeta,
    ...metaOverrides,
  }
  const rows = objectsToRows(headers, entries)
  // If body already had a table, replace; otherwise append.
  const newBody = existingBody && existingBody.includes('|')
    ? replaceFirstTable(existingBody, headers, rows)
    : (existingBody || '').trimEnd() + '\n\n' + serializeTable(headers, rows) + '\n'
  return serializeFrontmatter(meta, newBody.startsWith('\n') ? newBody : '\n' + newBody)
}

