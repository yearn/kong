import { z } from 'zod'
import { toEventSelector } from 'viem'
import { ThingSchema, zhexstring } from 'lib/types'
import { getBlockTime } from 'lib/blocks'
import { mq } from 'lib'

export const topics = [
  `event StrategyRevoked(address indexed strategy)`
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { blockNumber, args } = z.object({
    blockNumber: z.bigint({ coerce: true }),
    args: z.object({
      strategy: zhexstring
    })
  }).parse(data)

  const revokedBlockNumber = blockNumber
  const revokedBlockTime = revokedBlockNumber ? await getBlockTime(chainId, revokedBlockNumber) : 0n
  await mq.add(mq.q.load, mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: args.strategy,
    label: 'strategy',
    defaults: {
      revoked: true,
      revokedBlockNumber,
      revokedBlockTime
    }
  }))
}