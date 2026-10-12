// Dirty-file queue — persisted in IndexedDB so writes survive reloads.
// Key: filename. Value: { enqueuedAt }.

import { idbGet, idbSet, idbDel, idbKeys, openDB } from './idb.js'

const STORE = 'queue'

export async function enqueue(filename) {
  await idbSet(STORE, filename, { enqueuedAt: Date.now(), revision: crypto.randomUUID() })
}

export async function dequeue(filename) {
  await idbDel(STORE, filename)
}

export async function peekAll() {
  return idbKeys(STORE)
}

export async function has(filename) {
  return (await idbGet(STORE, filename)) != null
}

export async function queueRevision(filename) {
  const value = await idbGet(STORE, filename)
  return value?.revision ?? value?.enqueuedAt ?? null
}

export async function dequeueIfUnchanged(filename, revision) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const request = store.get(filename)
    let unchanged = false
    request.onsuccess = () => {
      const current = request.result?.revision ?? request.result?.enqueuedAt ?? null
      unchanged = current === revision
      if (unchanged) store.delete(filename)
    }
    tx.oncomplete = () => resolve(unchanged)
    tx.onerror = () => reject(tx.error)
  })
}
