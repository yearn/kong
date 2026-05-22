import 'lib/global'
import path from 'path'
import dotenv from 'dotenv'
const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

import { mq } from 'lib'

type Cmd = 'abis' | 'replays' | 'manuals' | 'waveydb'

async function main() {
  const [cmd, ...rest] = process.argv.slice(2) as [Cmd, ...string[]]
  const dataJson = rest.find(a => a.startsWith('--data='))?.slice('--data='.length)
  const data = dataJson ? JSON.parse(dataJson) : {}

  switch (cmd) {
  case 'abis':
    await mq.add(mq.job.fanout.abis, data)
    break
  case 'replays':
    await mq.add(mq.job.fanout.abis, { ...data, replay: { enabled: true } })
    break
  case 'manuals':
    await mq.add(mq.job.extract.manuals, data)
    break
  case 'waveydb':
    await mq.add(mq.job.extract.waveydb, data)
    break
  default:
    console.error(`unknown cmd: ${cmd}`)
    process.exit(2)
  }

  await mq.down()
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
