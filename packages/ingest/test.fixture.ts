import 'lib/global'
import path from 'path'
import dotenv from 'dotenv'
import chai from 'chai'
import chaiAlmost from 'chai-almost'
import { rpcs } from './rpcs'
import { cache } from 'lib'
import { dbMigrate, Postgres, Redis } from 'lib/helpers/tests'
import db from './db'
import { AbstractStartedContainer } from 'testcontainers'

const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

chai.use(chaiAlmost())
const containers: AbstractStartedContainer[] = []

export const mochaGlobalSetup = async function() {
  console.log('⬆', 'starting test containers')

  const postgres = await Postgres.start()
  const redis = await Redis.start()

  containers.push(postgres, redis)

  await dbMigrate(postgres, redis)

  console.log('⬆', 'containers all set')
  console.log('⬆', 'starting rpcs and cache')
  await Promise.all([rpcs.up(), cache.up()])
  console.log('⬆', 'test fixture up')
}

export const mochaGlobalTeardown = async () => {
  await Promise.all([db.end(), rpcs.down(), cache.down()])
  await Promise.all(containers.map(container => container.stop()))
  console.log('⬇', 'test fixture down')
}

process.on('SIGINT', async () => {
  await mochaGlobalTeardown()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await mochaGlobalTeardown()
  process.exit(0)
})
