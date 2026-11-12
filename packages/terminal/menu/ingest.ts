import { abisConfig, mq } from 'lib'
import prompts from 'prompts'
import { MenuAction } from '.'
import * as things from '../../ingest/things'

export default {
  action,
  menu: { title: 'Ingest', value: 'ingest' }
} as MenuAction

async function action() {
  const { q, address, confirm } = await prompts([
    {
      type: 'select',
      name: 'q',
      message: 'pick an ingest job',
      choices: [
        { title: 'fanout abis', value: {
          job: mq.job.fanout.abis
        }},
        { title: 'fanout replays', value: {
          job: mq.job.fanout.abis,
          data: { replay: {
            enabled: true
          }}
        }},
        { title: 'extract manauls', value: {
          job: mq.job.extract.manuals
        }},
        { title: 'extract snapshot (address)', value: {
          job: mq.job.extract.snapshot,
          byAddress: true
        }},
      ]
    },
    {
      type: prev => prev.byAddress ? 'text' : null,
      name: 'address',
      message: 'address'
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: (_, all) => `🤔 ${all.q.job.queue}/${all.q.job.name}?`,
    }
  ])

  if (!confirm) return
  if (q.byAddress) return snapshotAddress(address)
  await mq.add(q.job, q.data || {})
}

async function snapshotAddress(address: string) {
  const target = address.trim().toLowerCase()
  for (const abi of abisConfig.abis) {
    const sources = [...abi.sources]
    if (abi.things) sources.push(...(await things.get(abi.things)).map(thing => ({
      chainId: thing.chainId,
      address: thing.address,
      inceptBlock: thing.defaults.inceptBlock,
      inceptTime: thing.defaults.inceptTime,
      skip: false,
      only: false
    })))
    for (const source of sources.filter(s => s.address.toLowerCase() === target)) {
      console.log('📸', abi.abiPath, source.chainId, source.address)
      await mq.add(mq.job.extract.snapshot, { chainId: source.chainId, abi, source })
    }
  }
}
