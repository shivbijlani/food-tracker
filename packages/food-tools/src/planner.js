import { createTools, requireValue } from './tools.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const ROOT = `${GRAPH}/me/drive/special/approot`
const allowed = /^(suggestions\.csv|recipes\.md|(?:entries|protein)-\d{4}-\d{2}\.md)$/
class NeedSnapshot extends Error {}
class NeedWrite extends Error {
  constructor(name, content, snapshot) {
    super('A conditional write is required; no write has been performed.')
    this.plan = {
      filename: name,
      request: snapshot.id ? {
        method: 'PUT', url: `${GRAPH}/me/drive/items/${encodeURIComponent(snapshot.id)}/content`,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'If-Match': snapshot.etag }, body: content,
      } : {
        method: 'PUT', url: `${ROOT}:/${encodeURIComponent(name)}:/content`,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'If-None-Match': '*' }, body: content,
      },
      afterWrite: 'Discard cached snapshots, re-read the monthly file and catalog, then rerun the same commit request to verify its durable receipt. On 412 do the same fresh re-read/replan before retrying; never replay a stale write body.',
    }
  }
}

// Broker transport: only data and guarded HTTP plans cross this boundary.
// Authentication and HTTP execution stay entirely outside the Node process.
export async function planTool({ tool, arguments: args = {}, snapshots = {} }) {
  const missing = new Set()
  const store = {
    async read(name) {
      requireValue(allowed.test(name), 'Unsupported snapshot filename.')
      if (!Object.hasOwn(snapshots, name)) { missing.add(name); throw new NeedSnapshot() }
      const snapshot = snapshots[name]
      requireValue(snapshot && (snapshot.content === null || typeof snapshot.content === 'string'), `Invalid ${name} snapshot.`)
      requireValue(snapshot.content === null ? snapshot.id === null && snapshot.etag === null :
        typeof snapshot.id === 'string' && snapshot.id && typeof snapshot.etag === 'string' && snapshot.etag, `Snapshot ${name} needs the matching Graph item ID and eTag, or explicit nulls for a confirmed 404.`)
      return snapshot
    },
    async write(name, content, snapshot) { throw new NeedWrite(name, content, snapshot) },
  }
  const tools = createTools(store)
  requireValue(Object.hasOwn(tools, tool), 'Unknown food tool.')
  try {
    const result = await tools[tool](args)
    return { state: tool === 'commit_food_log' ? 'already_applied' : 'read_complete', result }
  } catch (e) {
    if (e instanceof NeedSnapshot) {
      return {
        state: 'read_required',
        reads: [...missing].map(filename => ({
          filename, method: 'GET', url: `${ROOT}:/${encodeURIComponent(filename)}`,
          select: ['id', 'eTag', 'content.downloadUrl'],
          instructions: 'Fetch metadata and content through the secure Graph broker. Recheck item ID/eTag after download; discard/retry if changed. Never send Graph Authorization to a download host. Supply matching content/id/etag, or nulls only after a confirmed 404.',
        })),
      }
    }
    if (e instanceof NeedWrite) return { state: 'write_required', write: e.plan }
    throw e
  }
}
