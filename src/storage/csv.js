// Simple CSV parser and serializer.

export function parseCSV(content) {
  if (!content || !content.trim()) return []
  const lines = content.split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 1) return []

  const headers = lines[0].split(',').map(h => h.trim())
  const rows = lines.slice(1).map(line => {
    const values = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    values.push(current.trim())

    const obj = {}
    headers.forEach((h, i) => {
      obj[h] = values[i] || ''
    })
    return obj
  })
  return rows
}

export function serializeCSV(headers, objects) {
  const headerLine = headers.join(',')
  const bodyLines = objects.map(obj => {
    return headers.map(h => {
      let val = String(obj[h] ?? '')
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val.replace(/"/g, '""')}"`
      }
      return val
    }).join(',')
  })
  return [headerLine, ...bodyLines].join('\n') + '\n'
}
