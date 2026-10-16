import { ToolError, requireValue } from './tools.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const ROOT = `${GRAPH}/me/drive/special/approot`
const allowed = /^(suggestions\.csv|recipes\.md|(?:entries|protein)-\d{4}-\d{2}\.md)$/

export function oneDriveStore({ getAccessToken, fetchImpl = fetch }) {
  async function request(url, init = {}) {
    const token = await getAccessToken()
    if (!token) throw new ToolError('AUTH_REQUIRED', 'Supply a Food Tracker access token through the secure runtime or sign in explicitly.')
    let response
    try {
      response = await fetchImpl(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
    } catch {
      throw new ToolError('NETWORK_ERROR', 'OneDrive request failed. Retry with the same operationId.')
    }
    if (response.status === 401) throw new ToolError('AUTH_REQUIRED', 'OneDrive sign-in expired; reconnect through the secure runtime.')
    if (response.status === 403) throw new ToolError('ACCESS_DENIED', 'Food Tracker AppFolder access was denied. Check the connector registration and consent.')
    if ([409, 412].includes(response.status)) throw new ToolError('PRECONDITION_FAILED', 'OneDrive changed concurrently.')
    if (!response.ok && response.status !== 404) throw new ToolError('ONEDRIVE_ERROR', `OneDrive returned HTTP ${response.status}.`)
    return response
  }
  function path(name) {
    requireValue(allowed.test(name), 'Unsupported Food Tracker filename.')
    return `${ROOT}:/${encodeURIComponent(name)}`
  }
  async function readOnce(name) {
      // The download URL belongs to this exact immutable item version. Do not
      // fetch /content separately after reading metadata (a version race).
      const response = await request(`${path(name)}?$select=id,eTag,name,content.downloadUrl`)
      if (response.status === 404) return { content: null, etag: null, id: null }
      const item = await response.json()
      if (!item.eTag || !item.id || !item['@microsoft.graph.downloadUrl']) throw new ToolError('INVALID_RESPONSE', 'OneDrive did not return versioned file metadata.')
      let download
      try { download = await fetchImpl(item['@microsoft.graph.downloadUrl']) }
      catch { throw new ToolError('NETWORK_ERROR', 'OneDrive download failed.') }
      if (!download.ok) throw new ToolError('ONEDRIVE_ERROR', `OneDrive download returned HTTP ${download.status}.`)
      // Confirm that the metadata/content pair did not cross a concurrent edit.
      const check = await request(`${path(name)}?$select=id,eTag`)
      if (check.status === 404) throw new ToolError('PRECONDITION_FAILED', 'OneDrive changed during read.')
      const version = await check.json()
      if (version.id !== item.id || version.eTag !== item.eTag) throw new ToolError('PRECONDITION_FAILED', 'OneDrive changed during read.')
      return { content: await download.text(), etag: item.eTag, id: item.id }
  }
  return {
    async read(name) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try { return await readOnce(name) }
        catch (e) { if (e.code !== 'PRECONDITION_FAILED') throw e }
      }
      throw new ToolError('CONCURRENT_UPDATE', 'OneDrive kept changing during read. Retry.')
    },
    async write(name, content, snapshot) {
      path(name)
      const { id, etag } = snapshot
      if (!id) {
        // Create-only upload: Graph answers 409 if another writer created the
        // file first, which surfaces as PRECONDITION_FAILED so callers re-read.
        // (POST /children with `file: {}` is rejected by Graph with HTTP 400.)
        await request(`${path(name)}:/content?@microsoft.graph.conflictBehavior=fail`, {
          method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content,
        })
        return
      }
      if (!etag) throw new ToolError('INVALID_RESPONSE', 'Missing OneDrive write precondition.')
      await request(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`, {
        method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'If-Match': etag }, body: content,
      })
    },
  }
}
