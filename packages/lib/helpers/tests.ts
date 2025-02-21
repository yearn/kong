import 'lib/global'
import { cache } from '../cache'
import { rpcs } from '../rpcs'
import db from '../../ingest/db'
import path from 'path'
import dotenv from 'dotenv'
const envPath = path.join(__dirname, '../../../', '.env')
dotenv.config({ path: envPath })

export async function setup() {
  const { $ } = await import('bun')
  await $`docker-compose up -d`
  await $`wait-on tcp:localhost:5432`.quiet()
  await $`wait-on tcp:localhost:6379`.quiet()
  await $`sleep 8`.quiet()
  await $`bun run --filter db migrate up`.quiet()
  await Promise.all([rpcs.up(), cache.up()])
  console.log('⬆', 'test fixture up')
}

export async function teardown() {
  const { $ } = await import('bun')
  await Promise.all([rpcs.down(), cache.down(), db.end()])
  await $`docker-compose down`
  console.log('⬇', 'test fixture down')
}
