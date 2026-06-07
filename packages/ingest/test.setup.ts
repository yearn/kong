import { afterAll, beforeAll } from 'vitest'
import { cache, mq } from 'lib'
import { rpcs } from './rpcs'
import fs from 'fs'
import path from 'path'

const envPath = path.join(__dirname, '.vitest.env.json')
if (fs.existsSync(envPath)) {
  const env = JSON.parse(fs.readFileSync(envPath, 'utf8')) as Record<string, string>
  Object.assign(process.env, env)
}

beforeAll(async () => {
  await Promise.all([rpcs.up(), cache.up()])
})

afterAll(async () => {
  await Promise.all([rpcs.down(), cache.down(), mq.down()])
})
