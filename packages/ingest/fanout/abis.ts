import { abisConfig, chains, mq, sentry } from 'lib'
import * as things from '../things'
import { clearNegativePriceCache } from '../prices'
import WebhookCollector from './webhooks'
import { findBusyMatch } from './isBusy'

export default class AbisFanout {
  async fanout(data: object) {
    const chainIds = new Set<number>(chains.map(chain => chain.id))
    const planned = await Promise.all(abisConfig.abis.map(async abi => ({
      abi,
      sources: [...abi.sources, ...(abi.things ? (await things.get(abi.things)).filter(thing => chainIds.has(thing.chainId)).map(thing => ({
        chainId: thing.chainId, address: thing.address, inceptBlock: thing.defaults.inceptBlock,
        inceptTime: thing.defaults.inceptTime, skip: false, only: false
      })) : [])]
    })))
    const readers = new Map<string, Set<string>>()
    for (const { abi, sources } of planned) for (const source of sources) {
      const key = `${source.chainId}-${source.address.toLowerCase()}`
      if (!readers.has(key)) readers.set(key, new Set())
      readers.get(key)!.add(abi.abiPath)
    }
    const overlaps = [...readers].filter(([, paths]) => paths.size > 1)
    sentry.gaugeMetric('abi_reader_overlap.addresses', overlaps.length, { component: 'ingest' })
    console.info('ABI_READER_OVERLAP_BASELINE', { count: overlaps.length, sample: Object.fromEntries(overlaps.slice(0, 10).map(([key, paths]) => [key, [...paths]])) })

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

    if ((data as { replay?: { enabled?: boolean } }).replay?.enabled) await clearNegativePriceCache()

    const webhookCollector = new WebhookCollector()

    await mq.add(mq.job.extract.manuals, data)
    for (const { abi, sources } of planned) {
      for (const source of sources) {
        console.info('🤝', 'source', 'abiPath', abi.abiPath, source.chainId, source.address)
        const _data = { ...data, chainId: source.chainId, abi, source }
        await mq.add(mq.job.fanout.events, _data)
        await mq.add(mq.job.extract.snapshot, _data)
        await mq.add(mq.job.fanout.timeseries, _data)
        webhookCollector.collect(abi, source)
      }
    }

    await webhookCollector.flush()
  }
}
