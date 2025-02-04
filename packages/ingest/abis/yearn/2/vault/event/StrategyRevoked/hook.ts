import { z } from 'zod'
import { toEventSelector } from 'viem'
import { ThingSchema, zhexstring } from 'lib/types'
import { mq } from 'lib'

export const topics = [
  'event StrategyRevoked(address indexed strategy)'
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { args } = z.object({
    blockNumber: z.bigint({ coerce: true }),
    args: z.object({
      strategy: zhexstring
    })
  }).parse(data)

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: args.strategy,
    label: 'strategy',
    defaults: {
      revoked: true
    }
  }))
}
