// Copies the @shivbijlani/folder-sync source tree into public/folder-sync/
// so Vite serves the service worker and its imports from the app's origin.

import { cp, rm, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, '..', 'packages', 'folder-sync', 'src')
const DEST = resolve(__dirname, '..', 'public', 'folder-sync')

await rm(DEST, { recursive: true, force: true })
await mkdir(DEST, { recursive: true })
await cp(SRC, DEST, { recursive: true })
console.log(`[copy-sw] ${SRC} → ${DEST}`)
