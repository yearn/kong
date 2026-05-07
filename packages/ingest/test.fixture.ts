import 'lib/global'
import chai from 'chai'
import chaiAlmost from 'chai-almost'
import dotenv from 'dotenv'
import { cache, mq } from 'lib'
import path from 'path'
import db from './db'
import { rpcs } from './rpcs'

const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

chai.use(chaiAlmost())

export const mochaGlobalSetup = async function() {
  console.log('⬆', 'starting rpcs and cache')
  await Promise.all([rpcs.up(), cache.up()])
  console.log('⬆', 'test fixture up')
}

export const mochaGlobalTeardown = async () => {
  await Promise.all([db.end(), rpcs.down(), cache.down(), mq.down()])
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
