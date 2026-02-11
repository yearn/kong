import { mq } from 'lib'
import { AbiConfig, AbiConfigSchema, SourceConfig, SourceConfigSchema } from 'lib/abis'
import webhookSubscriptions, { shouldCallWebhook } from 'lib/subscriptions'
import { getBlock } from 'lib/blocks'

type VaultKey = `${string}:${number}` // subscriptionId:chainId

export default class WebhookCollector {
  private collected = new Map<VaultKey, {
    subscription: typeof webhookSubscriptions[number],
    chainId: number,
    abiPath: string,
    vaults: { chainId: number, address: `0x${string}` }[]
  }>()

  collect(abi: AbiConfig, source: SourceConfig) {
    const { chainId, address } = SourceConfigSchema.parse(source)
    const { abiPath } = AbiConfigSchema.parse(abi)

    const subscriptions = webhookSubscriptions
      .filter(s => s.abiPath === abiPath)
      .filter(s => shouldCallWebhook(s, chainId, address))

    for (const subscription of subscriptions) {
      const key: VaultKey = `${subscription.id}:${chainId}`
      if (!this.collected.has(key)) {
        this.collected.set(key, {
          subscription,
          chainId,
          abiPath,
          vaults: []
        })
      }
      this.collected.get(key)!.vaults.push({ chainId, address: address as `0x${string}` })
    }
  }

  async flush() {
    const chainIds = new Set([...this.collected.values()].map(g => g.chainId))
    const blocks = new Map(await Promise.all(
      [...chainIds].map(async chainId => [chainId, await getBlock(chainId)] as const)
    ))

    await Promise.all([...this.collected.values()].map(group => {
      const { number: blockNumber, timestamp: blockTime } = blocks.get(group.chainId)!
      return mq.add(mq.job.extract.webhook, {
        abiPath: group.abiPath,
        blockNumber,
        blockTime,
        subscription: group.subscription,
        vaults: group.vaults
      })
    }))

    this.collected.clear()
  }
}
