import { spawn } from 'child_process'
import path from 'path'
import dotenv from 'dotenv'

// load .env so RPC URLs reach the ingest container via TestEnvironment
dotenv.config({ path: path.join(__dirname, '../..', '.env') })

const vitestBin = path.resolve(__dirname, '../../node_modules/.bin/vitest')
const userArgs = process.argv.slice(2)
const specArgs = userArgs.length > 0 ? userArgs : ['containers.spec.ts', 'yvusd-estimated-apr.containers.spec.ts']

const proc = spawn(vitestBin, [
  'run',
  '--config', 'vitest.containers.config.ts',
  ...specArgs,
], {
  env: process.env,
  stdio: 'inherit',
  shell: true,
  cwd: __dirname,
})

proc.on('close', (code: number) => process.exit(code))
proc.on('exit', (code: number) => process.exit(code))
proc.on('error', () => process.exit(1))

process.on('SIGINT', () => { proc.kill(); process.exit(0) })
process.on('SIGTERM', () => { proc.kill(); process.exit(0) })
