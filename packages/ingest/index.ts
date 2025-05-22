import 'lib/global'

import path from 'path'
import dotenv from 'dotenv'
const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

import fs from 'fs'
import { rpcs } from './rpcs'
import { Processor, ProcessorPool } from 'lib/processor'
import { cache, chains, abisConfig, crons as cronsConfig, mq } from 'lib'
import db from './db'
import { camelToSnake } from 'lib/strings'

const exportsProcessor = (filePath: string): boolean => {
  const fileContent = fs.readFileSync(filePath, 'utf8')
  const regex = /export default class \S+ implements Processor/
  return regex.test(fileContent)
}

console.log('🔗', 'chain', `[${chains.map(c => c.name.toLowerCase()).join(' x ')}]`)
console.log('🎯', 'abi target', `[${abisConfig.abis.map(c => c.abiPath).join(' x ')}]`)

const pools = fs.readdirSync(__dirname, { withFileTypes: true }).map(dirent => {
  const tenMinutes = 10 * 60 * 1000
  if (dirent.isDirectory()) {
    const indexPath = path.join(__dirname, dirent.name, 'index.ts')
    if (fs.existsSync(indexPath) && exportsProcessor(indexPath)) {
      console.log('⬆', 'processor up', dirent.name)
      const ProcessorClass = require(indexPath).default
      return new ProcessorPool(ProcessorClass, 1, tenMinutes)
    }
  }
}).filter(p => p) as Processor[]

const crons = cronsConfig.default
  .filter(cron => cron.start)
  .map(cron => new Promise(() => {
    const job = mq.job[cron.queue][cron.job]
    if (job.bychain) {
      for (const chain of chains) {
        mq.add(job, { id: camelToSnake(cron.name), chainId: chain.id }, {
          repeat: { pattern: cron.schedule }
        }).then(() => {
          console.log('⬆', 'cron up', cron.name, chain.id)
        })
      }

    } else {
      mq.add(job, { id: camelToSnake(cron.name) }, {
        repeat: { pattern: cron.schedule }
      }).then(() => {
        console.log('⬆', 'cron up', cron.name)
      })

    }
  }))

const abis = abisConfig.cron.start
  ? mq.add(mq.job.fanout.abis, { id: 'mq.job.fanout.abis' }, {
    repeat: { pattern: abisConfig.cron.schedule }
  }).then(() => {
    console.log('⬆', 'abis up')
  }) : Promise<null>

function up() {
  Promise.all([
    rpcs.up(),
    cache.up(),
    ...pools.map(pool => pool.up()),
    ...crons,
    abis,
  ]).then(() => {

    console.log('🐒 ingest up')

  }).catch(error => {
    console.error('🤬', error)
    process.exit(1)
  })
}

function down() {
  Promise.all([
    ...pools.map(pool => pool.down()),
    rpcs.down(),
    cache.down(),
    db.end()
  ]).then(() => {

    console.log('🐒 ingest down')
    process.exit(0)

  }).catch(error => {
    console.error('🤬', error)
    process.exit(1)
  })
}

up()
process.on('SIGINT', down)
process.on('SIGTERM', down)
