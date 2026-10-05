import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const manifestPath = require.resolve('@typescript/native/package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const compiler = path.resolve(path.dirname(manifestPath), manifest.bin.tsc)
const version = spawnSync(process.execPath, [compiler, '--version'], { encoding: 'utf8' })
if (manifest.version !== '7.0.2' || version.status !== 0 || version.stdout.trim() !== 'Version 7.0.2') {
  console.error(`Expected native TypeScript 7.0.2; package=${manifest.version}, compiler=${version.stdout?.trim() || version.stderr?.trim()}`)
  process.exit(1)
}
const result = spawnSync(process.execPath, [compiler, '--noEmit', '--pretty', 'false', ...process.argv.slice(2)], {
  cwd: process.cwd(), stdio: 'inherit'
})
if (result.error || result.signal) console.error(result.error ?? `Compiler terminated by ${result.signal}`)
process.exitCode = result.status ?? 1
