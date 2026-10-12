import { describe, it, expect, vi } from 'vitest'

const { values } = vi.hoisted(() => ({ values: new Map() }))
vi.mock('./idb.js', () => ({
  idbGet: async (_, key) => values.get(key),
  idbSet: async (_, key, value) => values.set(key, value),
  idbDel: async (_, key) => values.delete(key),
  idbKeys: async () => [...values.keys()],
  openDB: async () => ({
    transaction() {
      const tx = {
        objectStore: () => ({
          get(key) {
            const request = {}
            queueMicrotask(() => {
              request.result = values.get(key)
              request.onsuccess()
              tx.oncomplete()
            })
            return request
          },
          delete: key => values.delete(key),
        }),
      }
      return tx
    },
  }),
}))
import { enqueue, queueRevision, dequeueIfUnchanged } from './queue.js'

describe('conditional queue draining for food sync', () => {
  it('does not drop a new UI write that arrived during a remote push', async () => {
    await enqueue('entries-2026-10.md')
    const revision = await queueRevision('entries-2026-10.md')
    await enqueue('entries-2026-10.md')
    expect(await dequeueIfUnchanged('entries-2026-10.md', revision)).toBe(false)
    expect(await queueRevision('entries-2026-10.md')).not.toBeNull()
    const current = await queueRevision('entries-2026-10.md')
    expect(await dequeueIfUnchanged('entries-2026-10.md', current)).toBe(true)
    expect(await queueRevision('entries-2026-10.md')).toBeNull()
  })
  it('can drain legacy queue items without revisions', async () => {
    values.set('protein-2026-10.md', { enqueuedAt: 123 })
    expect(await queueRevision('protein-2026-10.md')).toBe(123)
    expect(await dequeueIfUnchanged('protein-2026-10.md', 123)).toBe(true)
  })
})
