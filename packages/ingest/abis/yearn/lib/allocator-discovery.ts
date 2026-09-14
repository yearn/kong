import { mq } from 'lib'
import { estimateCreationBlock } from 'lib/blocks'
import { ThingSchema } from 'lib/types'
import { getAddress, zeroAddress, type Address } from 'viem'
import { rpcs } from '../../../rpcs'

// Assignments can point to shared or custom contracts with no factory record.
// Use the combined allocator ABI; factory provenance is resolved separately.
export async function discoverAllocator(chainId: number, address: Address) {
  const allocator = getAddress(address)
  if (allocator === zeroAddress) return
  const code = await rpcs.next(chainId).getBytecode({ address: allocator })
  if (!code || code === '0x') return
  const block = await estimateCreationBlock(chainId, allocator)
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: allocator, label: 'debtAllocator',
    defaults: { inceptBlock: block.number, inceptTime: block.timestamp }
  }))
}
