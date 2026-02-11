import { abisConfig, chains, mq } from 'lib'
import * as things from '../things'
import WebhookCollector from './webhooks'

export default class AbisFanout {
  async fanout(data: object) {
    const webhookCollector = new WebhookCollector()

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
              inceptTime: _thing.defaults.inceptTime
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
