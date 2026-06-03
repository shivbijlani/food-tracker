// Minimal markdown table parser/serializer.

export function parseTable(content, expectedHeaders) {
  const lines = content.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (line.startsWith('|') && line.endsWith('|')) {
      const headers = splitRow(line)
      const sep = (lines[i + 1] || '').trim()
      if (/^\|[-\s|:]+\|$/.test(sep)) {
        if (!expectedHeaders || expectedHeaders.every(h => headers.includes(h))) {
          const rows = []
          let j = i + 2
          while (j < lines.length) {
            const r = lines[j].trim()
            if (!r.startsWith('|')) break
            rows.push(splitRow(r))
            j++
          }
          return { headers, rows, startLine: i, endLine: j - 1 }
        }
      }
    }
    i++
  }
  return { headers: [], rows: [], startLine: -1, endLine: -1 }
}

function splitRow(line) {
  const inner = line.replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map(c => c.trim())
}

export function rowsToObjects(headers, rows) {
  return rows.map(r => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = r[i] ?? '' })
    return obj
  })
}

export function objectsToRows(headers, objects) {
  return objects.map(o => headers.map(h => String(o[h] ?? '')))
}

export function serializeTable(headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`
  const sepLine = `|${headers.map(() => '------').join('|')}|`
  const bodyLines = rows.map(r => `| ${r.map(c => escapeCell(c)).join(' | ')} |`)
  return [headerLine, sepLine, ...bodyLines].join('\n')
}

function escapeCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function replaceFirstTable(content, headers, rows) {
  const lines = content.split(/\r?\n/)
  const { startLine, endLine } = parseTable(content)
  const newTable = serializeTable(headers, rows).split('\n')
  if (startLine === -1) {
    return content.trimEnd() + '\n\n' + newTable.join('\n') + '\n'
  }
  const before = lines.slice(0, startLine)
  const after = lines.slice(endLine + 1)
  return [...before, ...newTable, ...after].join('\n')
}

export const DAILY_LOG_HEADERS = [
  'Date', 'Meal', 'Food Description', 'Calories', 'Protein (g)',
  'Calcium (mg)', 'Veg Servings', 'Water (glasses)', 'Omega-3', 'Notes'
]

export const GOALS_HEADERS = ['Nutrient', 'Target', 'Notes']

export const RECIPE_HEADERS = ['Recipe', 'Servings', 'Calories', 'Protein (g)', 'Calcium (mg)', 'Notes']

export const PROTEIN_LOG_HEADERS = ['Date', 'Meal', 'Protein (g)']

export const WEIGHT_HEADERS = ['Date', 'Weight', 'Unit', 'Notes']
