import 'lib/global'
import path from 'path'
import dotenv from 'dotenv'
import chai from 'chai'
import chaiAlmost from 'chai-almost'
import { beforeAll, inject } from 'vitest'
import { cache } from 'lib'
import { rpcs } from './rpcs'

dotenv.config({ path: path.join(__dirname, '../..', '.env') })
chai.use(chaiAlmost())

// Belt-and-suspenders: ensure the container connection env is present in this
// worker before any test module constructs the pg Pool (done at import time).
const tc = inject('testcontainers') as Record<string, string | number> | undefined
if (tc) {
  process.env.POSTGRES_HOST = String(tc.host)
  process.env.POSTGRES_PORT = String(tc.port)
  process.env.POSTGRES_USER = String(tc.user)
  process.env.POSTGRES_PASSWORD = String(tc.password)
  process.env.POSTGRES_DB = String(tc.database)
  process.env.REDIS_HOST = String(tc.redisHost)
  process.env.REDIS_PORT = String(tc.redisPort)
}

// Bring rpcs + cache up once for the whole (single-fork, non-isolated) run.
// Teardown is intentionally omitted — the worker process exit reclaims the
// connections, so we don't tear them down between spec files.
let started = false
beforeAll(async () => {
  if (started) return
  started = true
  await Promise.all([rpcs.up(), cache.up()])
})
