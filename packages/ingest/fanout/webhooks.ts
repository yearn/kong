import { mq } from 'lib'
import { AbiConfig, AbiConfigSchema, SourceConfig, SourceConfigSchema } from 'lib/abis'
import webhookSubscriptions from 'lib/subscriptions'
import { getBlock } from 'lib/blocks'

export default class WebhooksFanout {
  async fanout(data: { abi: AbiConfig, source: SourceConfig }) {
    const { chainId, address } = SourceConfigSchema.parse(data.source)
    const { abiPath } = AbiConfigSchema.parse(data.abi)
    const subscriptions = webhookSubscriptions.filter(s => s.abiPath === abiPath)
    const { number: blockNumber, timestamp: blockTime } = await getBlock(chainId)
    for (const subscription of subscriptions) {
      await mq.add(mq.job.extract.webhook, {
        abiPath, chainId, address, blockNumber, blockTime, subscription
      })
    }
  }
}
