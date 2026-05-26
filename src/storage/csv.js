/**
 * Simple CSV parser and serializer.
 * Supports basic quoted values if they contain commas.
 */

export function parseCSV(text) {
  if (!text || !text.trim()) return []
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 2) return []

  const headers = splitCSVLine(lines[0])
  const rows = []

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i])
    const obj = {}
    headers.forEach((h, j) => {
      obj[h] = values[j] ?? ''
    })
    rows.push(obj)
  }

  return rows
}

export function serializeCSV(headers, objects) {
  const headerLine = headers.join(',')
  const bodyLines = objects.map(obj => {
    return headers.map(h => escapeCSV(obj[h] ?? '')).join(',')
  })
  return [headerLine, ...bodyLines].join('\n')
}

function splitCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result.map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"'))
}

function escapeCSV(val) {
  let s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    s = '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}
