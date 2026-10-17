// Diagnostic LLM logging (task #273).
//
// Mealjot is fully client-side, so there is no server to log to — and there
// shouldn't be one, because these records contain the user's meal text. Instead
// we keep a small ring buffer in localStorage that stays on-device until the
// user explicitly copies it out via Settings → "Copy diagnostic logs" and pastes
// it into a GitHub issue.
//
// Design rules:
//  - OFF by default. Nothing is recorded unless the user turns it on.
//  - Never throw. Logging is diagnostics; it must not be able to break a real
//    LLM call, so every entry point swallows its own errors.
//  - Never persist credentials. Headers are not captured at all, and free text
//    is scrubbed for key-shaped tokens before it is stored.

const ENABLED_STORAGE = 'mealjot-llm-debug-enabled'
const LOG_STORAGE = 'mealjot-llm-debug-log'

export const MAX_RECORDS = 20

// Cap any single free-text field so one huge prompt can't blow the ~5 MB
// localStorage budget (or make the pasted issue unreadable).
const MAX_FIELD_CHARS = 4000

/** Key-shaped tokens we scrub if they ever appear in captured text. */
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /github_pat_[A-Za-z0-9_]{8,}/g,
  /ghp_[A-Za-z0-9]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
]

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    // Some privacy modes throw on access rather than returning undefined.
    return null
  }
}

/** Strip anything that looks like an API key out of captured text. */
export function redact(value) {
  if (value == null) return value
  let text = typeof value === 'string' ? value : safeStringify(value)
  for (const re of SECRET_PATTERNS) text = text.replace(re, '[REDACTED]')
  if (text.length > MAX_FIELD_CHARS) {
    text = text.slice(0, MAX_FIELD_CHARS) + `\n…[truncated ${text.length - MAX_FIELD_CHARS} chars]`
  }
  return text
}

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function isEnabled() {
  const s = storage()
  if (!s) return false
  try {
    return s.getItem(ENABLED_STORAGE) === 'true'
  } catch {
    return false
  }
}

export function setEnabled(on) {
  const s = storage()
  if (!s) return
  try {
    if (on) s.setItem(ENABLED_STORAGE, 'true')
    else s.removeItem(ENABLED_STORAGE)
  } catch {
    // Quota or privacy-mode failure — diagnostics simply stay off.
  }
}

export function getLogs() {
  const s = storage()
  if (!s) return []
  try {
    const raw = s.getItem(LOG_STORAGE)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Corrupt buffer — treat as empty rather than breaking Settings.
    return []
  }
}

export function clearLogs() {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(LOG_STORAGE)
  } catch {
    // Ignore.
  }
}

/**
 * Append one interaction to the ring buffer. No-op unless logging is enabled.
 *
 * @param {{ feature?: string, provider?: string, model?: string,
 *           systemPrompt?: string, userPrompt?: string, responseText?: string,
 *           parsed?: unknown, status?: number|null, latencyMs?: number|null,
 *           error?: string|null, outcome?: string }} entry
 */
export function record(entry = {}) {
  if (!isEnabled()) return
  const s = storage()
  if (!s) return
  try {
    const rec = {
      at: new Date().toISOString(),
      feature: entry.feature || 'unknown',
      provider: entry.provider || null,
      model: entry.model || null,
      outcome: entry.outcome || (entry.error ? 'error' : 'ok'),
      status: entry.status ?? null,
      latencyMs: entry.latencyMs ?? null,
      systemPrompt: redact(entry.systemPrompt ?? ''),
      userPrompt: redact(entry.userPrompt ?? ''),
      responseText: redact(entry.responseText ?? ''),
      parsed: entry.parsed === undefined ? null : redact(entry.parsed),
      error: entry.error ? redact(String(entry.error)) : null,
    }
    const logs = getLogs()
    logs.push(rec)
    // FIFO: keep only the most recent MAX_RECORDS.
    const trimmed = logs.slice(-MAX_RECORDS)
    s.setItem(LOG_STORAGE, JSON.stringify(trimmed))
  } catch {
    // Never let diagnostics break a real call.
  }
}

/**
 * Serialize the buffer to Markdown that can be pasted straight into a GitHub
 * issue. The header is deliberately self-describing so a reader can spot a
 * model that is consistently misbehaving without asking follow-up questions.
 */
export function toMarkdown(logs = getLogs()) {
  if (!logs.length) return '_No LLM diagnostic logs recorded._'

  const models = [...new Set(logs.map(l => l.model).filter(Boolean))]
  const providers = [...new Set(logs.map(l => l.provider).filter(Boolean))]
  const features = [...new Set(logs.map(l => l.feature).filter(Boolean))]
  const bad = logs.filter(l => l.outcome && l.outcome !== 'ok')

  const lines = [
    '### Mealjot LLM diagnostics',
    '',
    `- **Provider:** ${providers.join(', ') || 'n/a'}`,
    `- **Model:** ${models.join(', ') || 'n/a'}`,
    `- **Feature:** ${features.join(', ') || 'n/a'}`,
    `- **Records:** ${logs.length} (${bad.length} not ok)`,
    `- **Range:** ${logs[0].at} → ${logs[logs.length - 1].at}`,
    '',
    '<!-- Keys are never stored; free text is scrubbed for key-shaped tokens. -->',
    '',
  ]

  logs.forEach((l, i) => {
    lines.push(`#### ${i + 1}. ${l.feature} — ${l.outcome} (${l.model || 'unknown model'})`)
    lines.push('')
    lines.push(`- at: \`${l.at}\``)
    lines.push(`- provider: \`${l.provider || 'n/a'}\` · status: \`${l.status ?? 'n/a'}\` · latency: \`${l.latencyMs ?? 'n/a'}ms\``)
    if (l.error) lines.push(`- error: \`${l.error}\``)
    lines.push('')
    if (l.systemPrompt) {
      lines.push('<details><summary>System prompt</summary>', '', '```text', l.systemPrompt, '```', '</details>', '')
    }
    if (l.userPrompt) {
      lines.push('<details><summary>User prompt</summary>', '', '```text', l.userPrompt, '```', '</details>', '')
    }
    lines.push('**Raw response**', '', '```text', l.responseText || '(empty)', '```', '')
    if (l.parsed) {
      lines.push('**Parsed**', '', '```json', typeof l.parsed === 'string' ? l.parsed : safeStringify(l.parsed), '```', '')
    }
  })

  return lines.join('\n')
}
