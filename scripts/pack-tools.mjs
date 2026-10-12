import { execFileSync } from 'node:child_process'
import { readFile, mkdir, copyFile, writeFile, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'public', 'tools')
await mkdir(output, { recursive: true })
if (!process.env.npm_execpath) throw new Error('Run this packaging script through npm run build.')
execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--workspace', '@shivbijlani/mealjot-tools', '--pack-destination', output, '--quiet'], {
  cwd: root, stdio: 'inherit',
})
const { version } = JSON.parse(await readFile(resolve(root, 'packages', 'food-tools', 'package.json'), 'utf8'))
const name = `mealjot-tools-${version}.tgz`
await copyFile(resolve(output, `shivbijlani-mealjot-tools-${version}.tgz`), resolve(output, name))
await unlink(resolve(output, `shivbijlani-mealjot-tools-${version}.tgz`))
const sha256 = createHash('sha256').update(await readFile(resolve(output, name))).digest('hex')
await writeFile(resolve(output, `${name}.sha256`), `${sha256}  ${name}\n`)
await copyFile(resolve(root, 'packages', 'food-tools', 'README.md'), resolve(output, 'README.md'))
await writeFile(resolve(output, 'version.json'), JSON.stringify({
  version, file: name, sha256, node: '>=22', clientId: '94f25f67-e08b-415e-b1aa-4159093d401d',
  scopes: ['Files.ReadWrite.AppFolder', 'offline_access'],
}, null, 2) + '\n')
console.log(`Tools ${version}: ${sha256}`)
