import './global'
import path from 'path'
import dotenv from 'dotenv'
import { AbstractStartedContainer } from 'testcontainers'
import { Postgres, Redis, dbMigrate, setTestcontainersEnv } from './helpers/tests'

const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

const containers: AbstractStartedContainer[] = []

export default async function setup() {
  const postgres = await Postgres.start()
  const redis = await Redis.start()
  containers.push(postgres, redis)

  await dbMigrate({ postgres })
  setTestcontainersEnv({ postgres, redis })

  return async () => {
    await Promise.all(containers.map(container => container.stop()))
  }
}
