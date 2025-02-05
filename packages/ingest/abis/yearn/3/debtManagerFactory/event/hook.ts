import { z } from 'zod'
import { mq } from 'lib'
import { toEventSelector } from 'viem'
import { estimateCreationBlock } from 'lib/blocks'
import { ThingSchema, zhexstring } from 'lib/types'

export const topics = [
  'event NewDebtAllocator(address indexed allocator, address indexed vault)'
].map(e => toEventSelector(e))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { allocator } = z.object({
    allocator: zhexstring,
    vault: zhexstring
  }).parse(data.args)

  const block = await estimateCreationBlock(chainId, allocator)
  const inceptBlock = block.number
  const inceptTime = block.timestamp

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: allocator,
    label: 'debtAllocator',
    defaults: {
      inceptBlock,
      inceptTime
    }
  }))
}
