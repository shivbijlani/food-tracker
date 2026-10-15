// Per-provider three-way file sync.
//
// Each connected provider keeps its own merge base: the content both sides
// agreed on after the last successful sync with *that* provider. Comparing
// local and remote against that base tells us which side changed, so a stale
// provider (e.g. a Google Drive copy that has not been synced for weeks) can
// never overwrite newer local data just because it is listed later.
//
//  - Food logs (entries-/protein-YYYY-MM.md) merge row by row via the injected
//    `mergeFoodLog` and are written with the provider's versioned
//    (compare-and-swap) read/write.
//  - Every other file is whole-file three-way: the changed side wins; if both
//    changed (or this provider has never synced the file) the newer mtime wins.
//
// All I/O is injected so the decision logic is unit-testable without a
// service worker or network.

export const FOOD_LOG_RE = /^(entries|protein)-\d{4}-\d{2}\.md$/

export function isFoodLogName(name) {
  return FOOD_LOG_RE.test(name)
}

/**
 * Decide the converged content of one whole file.
 * `base` is undefined when this provider never synced the file.
 * Returns the content both sides should hold (null = file deleted).
 */
export function resolveWholeFile({ base, local, remote, localMtime = 0, remoteMtime = 0, localDeleted = false }) {
  if (local === remote) return local
  const hasBase = base !== undefined
  const localChanged = !hasBase || local !== base
  const remoteChanged = !hasBase || remote !== base
  if (!localChanged) return remote == null ? local : remote
  if (!remoteChanged) return local
  if (local == null) {
    // Without a base, an explicit local delete is a deliberate change and
    // competes on time; a file merely absent locally is pulled.
    if (!hasBase && localDeleted) return localMtime >= remoteMtime ? null : remote
    return remote
  }
  if (remote == null) return local
  return localMtime >= remoteMtime ? local : remote
}

const baseKey = (pid, name) => `file-base:${pid}:${name}`
const foodBaseKey = (pid, name) => `food-base:${pid}:${name}`
const revKey = (pid, name) => `rev:${pid}:${name}`
// Opaque per-version marker (OneDrive eTag, Drive version); mtime as fallback.
const revOf = item => item?.rev ?? item?.mtime ?? null

/**
 * Sync every known file with one provider.
 *
 * io = {
 *   readLocal(name)  -> { content, mtime } | null   (content null = deleted)
 *   replaceLocal(name, expected, content) -> bool   (atomic; writes only if
 *                                                    local still === expected)
 *   listLocal()      -> string[]                    (names, including deleted)
 *   getMeta(key) / setMeta(key, value)
 *   mergeFoodLog(base, local, remote, name) -> string
 *   skip(name)       -> bool                        (handled elsewhere)
 * }
 */
export async function syncProviderFiles(provider, io) {
  const remoteList = await provider.listRemote(provider)
  const remoteByName = new Map(remoteList.map(item => [item.name, item]))
  const names = new Set([...remoteByName.keys(), ...(await io.listLocal())])
  for (const name of names) {
    if (io.skip?.(name)) continue
    const item = remoteByName.get(name) || null
    if (isFoodLogName(name) && provider.readVersioned && provider.writeVersioned) {
      await syncFoodLogFile(provider, name, item, io)
    } else {
      await syncWholeFile(provider, name, item, io)
    }
  }
}

async function localContent(io, name) {
  const rec = await io.readLocal(name)
  return rec ? rec.content ?? null : null
}

async function syncWholeFile(provider, name, item, io) {
  const pid = provider.id
  const base = await io.getMeta(baseKey(pid, name))
  const localRec = await io.readLocal(name)
  const local = localRec ? localRec.content ?? null : null
  if (!item && local == null) return
  const lastSeen = await io.getMeta(revKey(pid, name))
  // Skip the download when the remote file has not changed since we last
  // synced it: its content is still the base.
  const remoteUnchanged = item && base !== undefined && base !== null && lastSeen != null && lastSeen === revOf(item)
  if (remoteUnchanged && local === base) return
  const remote = !item ? null : remoteUnchanged ? base : await provider.readRemote(provider, name)

  const merged = resolveWholeFile({
    base, local, remote,
    localMtime: localRec?.mtime || 0,
    remoteMtime: item?.mtime || 0,
    localDeleted: !!localRec && localRec.content == null,
  })

  // Commit locally first, atomically against the content we merged from. If
  // the user edited meanwhile, push nothing: the next sync merges that edit.
  if (merged !== local && merged != null && !(await io.replaceLocal(name, local, merged))) return

  if (merged !== remote) {
    if (merged == null) {
      await provider.deleteRemote(provider, name)
    } else {
      const res = await provider.writeRemote(provider, name, merged)
      const rev = res?.rev ?? res?.mtime
      if (rev != null) await io.setMeta(revKey(pid, name), rev)
    }
  } else if (item) {
    await io.setMeta(revKey(pid, name), revOf(item))
  }
  await io.setMeta(baseKey(pid, name), merged)
}

async function syncFoodLogFile(provider, name, item, io) {
  const pid = provider.id
  const key = foodBaseKey(pid, name)
  const lastSeen = await io.getMeta(revKey(pid, name))
  for (let attempt = 0; attempt < 5; attempt++) {
    const base = await io.getMeta(key)
    const local = await localContent(io, name)
    if (!item && local == null) return
    if (item && base != null && local === base && lastSeen != null && lastSeen === revOf(item)) return
    const remote = await provider.readVersioned(name)
    const merged = io.mergeFoodLog(base ?? null, local, remote.content, name)
    if ((await localContent(io, name)) !== local) continue
    let wroteRemote = false
    if (merged !== remote.content && merged != null) {
      try { await provider.writeVersioned(name, merged, remote) }
      catch (e) { if (e.code === 'PRECONDITION_FAILED') continue; throw e }
      wroteRemote = true
    }
    await io.setMeta(key, merged)
    // Only remember the listed mtime when we did not just change the remote;
    // otherwise the next sync re-reads once to learn the new version.
    if (item && !wroteRemote) await io.setMeta(revKey(pid, name), revOf(item))
    if (merged !== local && merged != null && !(await io.replaceLocal(name, local, merged))) continue
    return
  }
  throw new Error('Food log changed during sync. Retry; no stale overwrite was made.')
}
