import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseline = JSON.parse(readFileSync(path.join(root, 'scripts/typecheck-baseline.json'), 'utf8'))
let failed = false
for (const [workspace, allowed] of Object.entries(baseline)) {
  const cwd = path.join(root, 'packages', workspace)
  const { scripts } = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'))
  const result = spawnSync(scripts.typecheck, {
    cwd, shell: true, encoding: 'utf8', env: { ...process.env, KONG_TYPECHECK_PROTOCOL: '1' }
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
  const noBaselineMatch = allowed.length > 0 && remaining.length === allowed.length
  const records = [...(result.stderr ?? '').matchAll(/^KONG_TYPECHECK_RESULT=(.+)$/gm)]
  let completion
  try { completion = records.length === 1 ? JSON.parse(records[0][1]) : undefined } catch { /* fail closed below */ }
  const failures = []
  if (result.error || result.signal) failures.push('workspace command crashed')
  if (!completion) failures.push('compiler initialization failed or completion record missing')
  else if (completion.error || completion.signal || ![0, 1, 2].includes(completion.status) || completion.unexpectedStderr || result.status !== completion.status) failures.push('compiler aborted or emitted unexpected failure output')
  if (unparsed.length) failures.push('unparsable compiler diagnostics')
  if (added.length) failures.push(`${added.length} new diagnostics`)
  if (noBaselineMatch) failures.push('lost coverage: no baseline diagnostic matched')
  if (completion?.status !== 0 && diagnostics.length === 0) failures.push('nonzero compiler exit without diagnostics')
  if (failures.length) {
    failed = true
    console.error(`${workspace}: typecheck failed — ${failures.join('; ')}`)
    if (noBaselineMatch) console.error(`Unmatched baseline entries:\n${remaining.join('\n')}`)
    console.error(result.error ?? ([...added, ...unparsed].length ? [...added, ...unparsed].join('\n') : output))
  } else {
    console.log(`${workspace}: ${diagnostics.length} known diagnostics; ${remaining.length} baseline diagnostics resolved; no new errors`)
  }
}
process.exitCode = failed ? 1 : 0
