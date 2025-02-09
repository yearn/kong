import 'lib/global'
import { config } from 'dotenv'
import { afterAll, beforeAll } from 'bun:test'
import { cache } from 'lib'
import { rpcs } from './packages/ingest/rpcs'
import path from 'path'

const envPath = path.join(__dirname, '.env')
config({ path: envPath })

beforeAll(async () => {
  const { $ } = await import('bun')
  await $`docker-compose up -d`
  await $`wait-on tcp:localhost:5432`.quiet()
  await $`wait-on tcp:localhost:6379`.quiet()
  await $`sleep 8`.quiet()
  await $`bun run --filter db migrate up`.quiet()
  await Promise.all([rpcs.up(), cache.up()])
  console.log('⬆', 'test fixture up')
})

afterAll(async () => {
  const { $ } = await import('bun')
  await Promise.all([rpcs.down(), cache.down()])
  await $`docker-compose down`
})


