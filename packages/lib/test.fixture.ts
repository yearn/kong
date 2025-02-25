import './global'
import path from 'path'
import dotenv from 'dotenv'
import { rpcs } from './rpcs'
import { cache } from './cache'
import { Postgres, Redis } from './helpers/tests'

const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

const containers: any[] = []

export const mochaGlobalSetup = async function() {
  const postgres = await Postgres.start()
  const redis = await Redis.start()
  containers.push(postgres, redis)

  process.env.POSTGRES_HOST = postgres.getHost()
  process.env.POSTGRES_PORT = postgres.getPort().toString()
  process.env.REDIS_HOST = redis.getHost()
  process.env.REDIS_PORT = redis.getPort().toString()

  await rpcs.up()
  await cache.up()
  console.log('⬆', 'test fixture up')
}

export const mochaGlobalTeardown = async () => {
  await cache.down()
  await rpcs.down()
  await Promise.all(containers.map(container => container.stop()))
  console.log('⬇', 'test fixture down')
}
