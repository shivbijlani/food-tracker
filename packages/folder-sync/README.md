# @shivbijlani/folder-sync

Local-first folder sync engine. Pluggable local adapters and cloud providers. Cloud I/O runs in a service worker; OAuth consent runs on the main thread.

## Concept

```
┌──────────────── main thread ────────────────┐    ┌────── service worker ──────┐
│  createSyncEngine({ localAdapter, providers })  │    │  drains dirty-file queue,  │
│  ├─ read/write/list/delete  → localAdapter      │    │  refreshes tokens,         │
│  ├─ writeFile() → enqueue(name) + nudgeSW       │ ←→ │  uploads/downloads via     │
│  ├─ connect(providerId) → OAuth popup           │    │  Drive / Graph fetch().    │
│  └─ subscribe(fn) ← BroadcastChannel status     │    │  Last-write-wins by mtime. │
└─────────────────────────────────────────────┘    └────────────────────────────┘
                            shared IndexedDB: tokens, queue
```

## Usage

```js
import { createSyncEngine, registerServiceWorker } from '@shivbijlani/folder-sync'
import { browserStorageAdapter } from '@shivbijlani/folder-sync/adapters/browser-storage'
import { googleDriveProvider } from '@shivbijlani/folder-sync/providers/google-drive'
import { oneDriveProvider } from '@shivbijlani/folder-sync/providers/onedrive'

await registerServiceWorker('/folder-sync-sw.js')

const engine = createSyncEngine({
  localAdapter: browserStorageAdapter({ prefix: 'myapp:' }),
  providers: [
    googleDriveProvider({ clientId: '...', folderName: 'myapp' }),
    oneDriveProvider({ clientId: '...', folderName: 'myapp' }),
  ],
})

engine.subscribe(({ state, providers }) => console.log(state, providers))

await engine.writeFile('hello.md', '# hello')
await engine.connect('google-drive')   // opens OAuth popup; SW takes over from there
```

## States

`idle | syncing | synced | offline | reconnect-required`

## License

MIT
