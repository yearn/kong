import { abisConfig, chains, mq, sentry } from 'lib'
import * as things from '../things'
import WebhookCollector from './webhooks'
import { findBusyMatch } from './isBusy'

export default class AbisFanout {
  async fanout(data: object) {
    const match = await findBusyMatch()
    if (match) {
      console.error(`🚨 ABI_FANOUT_SKIPPED_BUSY: previous ingestion work is still active or queued, queue=${match.queue} job=${match.jobName} status=${match.status}`)
      sentry.captureMessage('ABI_FANOUT_SKIPPED_BUSY', {
        level: 'warning',
        tags: { component: 'ingest', job: 'fanout.abis', reason: 'busy' },
        extra: { queue: match.queue, jobName: match.jobName, status: match.status }
      })
      return
    }

    const webhookCollector = new WebhookCollector()

    await mq.add(mq.job.extract.manuals, data)

    for (const abi of abisConfig.abis) {
      for (const source of abi.sources) {
        console.info('🤝', 'source', 'abiPath', abi.abiPath, source.chainId, source.address)
        const _data = { ...data, chainId: source.chainId, abi, source }
        await mq.add(mq.job.fanout.events, _data)
        await mq.add(mq.job.extract.snapshot, _data)
        await mq.add(mq.job.fanout.timeseries, _data)
        webhookCollector.collect(abi, source)
      }

      if (abi.things) {
        const chainIds = chains.map(chain => chain.id) as number[]
        const _things = (await things.get(abi.things)).filter(thing => chainIds.includes(thing.chainId))
        for (const _thing of _things) {
          console.info('🤝', 'thing', 'abiPath', abi.abiPath, _thing.chainId, _thing.address)
          const _data = {
            ...data,
            chainId: _thing.chainId,
            abi,
            source: {
              chainId: _thing.chainId,
              address: _thing.address,
              inceptBlock: _thing.defaults.inceptBlock,
              inceptTime: _thing.defaults.inceptTime,
              skip: false,
              only: false
            } }
          await mq.add(mq.job.fanout.events, _data)
          await mq.add(mq.job.extract.snapshot, _data)
          await mq.add(mq.job.fanout.timeseries, _data)
          webhookCollector.collect(abi, _data.source)
        }
      }
    }

    await webhookCollector.flush()
  }
}
