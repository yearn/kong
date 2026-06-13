import './global'
import path from 'path'
import dotenv from 'dotenv'
import { beforeAll, inject } from 'vitest'
import { rpcs } from './rpcs'
import { cache } from './cache'

dotenv.config({ path: path.join(__dirname, '../..', '.env') })

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

// Bring rpcs + cache up once for the single-fork run.
let started = false
beforeAll(async () => {
  if (started) return
  started = true
  await Promise.all([rpcs.up(), cache.up()])
})
