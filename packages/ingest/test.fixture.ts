import 'lib/global'
import dotenv from 'dotenv'
import fs from 'fs'
import { AbstractStartedContainer } from 'testcontainers'
import { Postgres, Redis, dbMigrate, setTestcontainersEnv } from 'lib/helpers/tests'
import path from 'path'

const envPath = path.join(__dirname, '../..', '.env')
const vitestEnvPath = path.join(__dirname, '.vitest.env.json')
dotenv.config({ path: envPath })
process.env.POSTGRES_SSL = ''

const containers: AbstractStartedContainer[] = []

export default async function setup() {
  const postgres = await Postgres.start()
  const redis = await Redis.start()
  containers.push(postgres, redis)

  await dbMigrate({ postgres })
  const env = setTestcontainersEnv({ postgres, redis })
  process.env.POSTGRES_SSL = ''
  process.env.POSTGRES_DATABASE = env.database
  fs.writeFileSync(vitestEnvPath, JSON.stringify({
    POSTGRES_HOST: env.host,
    POSTGRES_PORT: String(env.port),
    POSTGRES_USER: env.user,
    POSTGRES_PASSWORD: env.password,
    POSTGRES_DB: env.database,
    POSTGRES_DATABASE: env.database,
    POSTGRES_SSL: '',
    REDIS_HOST: env.redisHost,
    REDIS_PORT: env.redisPort
  }))

  console.log('⬆', 'test fixture up')

  return teardown
}

async function teardown() {
  await Promise.all(containers.map(container => container.stop()))
  fs.rmSync(vitestEnvPath, { force: true })
  console.log('⬇', 'test fixture down')
}
