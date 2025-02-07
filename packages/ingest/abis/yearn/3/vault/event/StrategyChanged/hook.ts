import { z } from 'zod'
import { erc20Abi, toEventSelector } from 'viem'
import { EvmAddressSchema, ThingSchema } from 'lib/types'
import { estimateCreationBlock } from 'lib/blocks'
import { mq } from 'lib'
import { rpcs } from '../../../../../../rpcs'
import strategyAbi from '../../../strategy/abi'

export const topics = [
  'event StrategyChanged(address indexed strategy, uint256 change_type)'
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: object) {
  const { args: { strategy }, blockNumber } = z.object({
    blockNumber: z.bigint({ coerce: true }),
    args: z.object({ strategy: EvmAddressSchema })
  }).parse(data)

  const {
    number: inceptBlock,
    timestamp: inceptTime
  } = await estimateCreationBlock(chainId, strategy)

  const asset = await rpcs.next(chainId, blockNumber).readContract({
    abi: strategyAbi, address: strategy, functionName: 'asset', blockNumber
  })

  const decimals = await rpcs.next(chainId, blockNumber).readContract({
    abi: erc20Abi, address: asset, functionName: 'decimals', blockNumber
  })

  mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: strategy,
    label: 'vault',
    defaults: {
      erc4626: true,
      asset, decimals,
      inceptBlock,
      inceptTime
    }
  }))
}
