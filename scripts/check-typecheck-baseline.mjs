import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseline = JSON.parse(readFileSync(path.join(root, 'scripts/typecheck-baseline.json'), 'utf8'))
let failed = false
for (const [workspace, allowed] of Object.entries(baseline)) {
  const result = spawnSync(path.join(root, 'node_modules/.bin/tsc'), ['--noEmit', '--pretty', 'false'], {
    cwd: path.join(root, 'packages', workspace), encoding: 'utf8'
  })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const diagnostics = [...output.matchAll(/^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/gm)]
    .map(match => `${match[1]}|${match[2]}|${match[3]}`)
  const unparsed = output.split('\n').filter(line => line.includes('error TS') && !/^(.+?)\(\d+,\d+\): error TS\d+: /.test(line))
  const remaining = [...allowed]
  const added = diagnostics.filter(diagnostic => {
    const index = remaining.indexOf(diagnostic)
    if (index < 0) return true
    remaining.splice(index, 1)
    return false
  })
  if (result.error || result.signal || (result.status !== 0 && diagnostics.length === 0) || added.length || unparsed.length) {
    failed = true
    console.error(`${workspace}: typecheck failed with ${added.length} new diagnostics`)
    console.error(result.error ?? ([...added, ...unparsed].length ? [...added, ...unparsed].join('\n') : output))
  } else {
    console.log(`${workspace}: ${diagnostics.length} known diagnostics; ${remaining.length} baseline diagnostics resolved; no new errors`)
  }
}
process.exitCode = failed ? 1 : 0
