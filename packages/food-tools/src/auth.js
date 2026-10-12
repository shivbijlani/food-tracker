import { ToolError } from './tools.js'

export const CLIENT_ID = '94f25f67-e08b-415e-b1aa-4159093d401d'
const ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const SCOPE = 'Files.ReadWrite.AppFolder offline_access'

export function environmentAuth(env = process.env) {
  const token = env.MEALJOT_ACCESS_TOKEN
  // Remove the inherited token before any child process could inherit it.
  delete env.MEALJOT_ACCESS_TOKEN
  return async () => token
}

export async function deviceAuth({ fetchImpl = fetch, notify = message => process.stderr.write(`${message}\n`), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  async function post(path, body) {
    let response
    try {
      response = await fetchImpl(`${ENDPOINT}/${path}`, {
        method: 'POST', body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
      })
    } catch { throw new ToolError('AUTH_NETWORK_ERROR', 'Microsoft sign-in request failed.') }
    return response.json()
  }
  const device = await post('devicecode', { scope: SCOPE })
  if (!device.device_code) throw new ToolError('AUTH_UNAVAILABLE', 'Device sign-in is unavailable. The Food Tracker registration may need approved public-client configuration.')
  notify(`To sign in to Food Tracker, open ${device.verification_uri} and enter ${device.user_code}.`)
  const deadline = Date.now() + device.expires_in * 1000
  let interval = (device.interval || 5) * 1000
  let record
  while (Date.now() < deadline) {
    await sleep(interval)
    const result = await post('token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code })
    if (result.access_token) { record = result; break }
    if (result.error === 'authorization_pending') continue
    if (result.error === 'slow_down') { interval += 5000; continue }
    throw new ToolError('AUTH_UNAVAILABLE', 'Microsoft declined device sign-in. Use a secure Food Tracker token broker or obtain approval for public-client configuration.')
  }
  if (!record) throw new ToolError('AUTH_EXPIRED', 'Device sign-in timed out.')
  let expires = Date.now() + record.expires_in * 1000
  return async () => {
    if (Date.now() >= expires - 60_000) {
      const refreshed = await post('token', { grant_type: 'refresh_token', refresh_token: record.refresh_token, scope: SCOPE })
      if (!refreshed.access_token) throw new ToolError('AUTH_REQUIRED', 'Microsoft sign-in expired; restart with explicit sign-in.')
      record = { ...refreshed, refresh_token: refreshed.refresh_token || record.refresh_token }
      expires = Date.now() + record.expires_in * 1000
    }
    return record.access_token
  }
}
