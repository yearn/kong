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

  const strategyCheck = await rpcs.next(chainId, blockNumber).multicall({
    contracts: [
      { address: strategy, abi: strategyAbi, functionName: 'FACTORY' },
      { address: strategy, abi: strategyAbi, functionName: 'keeper' },
      { address: strategy, abi: strategyAbi, functionName: 'management' },
      { address: strategy, abi: strategyAbi, functionName: 'isShutdown' },
      { address: strategy, abi: strategyAbi, functionName: 'lastReport' },
      { address: strategy, abi: strategyAbi, functionName: 'apiVersion' },
    ],
    blockNumber
  })

  const isTokenizedStrategy = strategyCheck.slice(0, 5).every(r => r.status === 'success')
  const apiVersion = strategyCheck[5].status === 'success' ? strategyCheck[5].result as string : undefined

  if (isTokenizedStrategy) {
    mq.add(mq.job.load.thing, ThingSchema.parse({
      chainId,
      address: strategy,
      label: 'strategy',
      defaults: {
        v3: true,
        erc4626: true,
        apiVersion,
        asset, decimals,
        inceptBlock,
        inceptTime
      }
    }))

    mq.add(mq.job.load.thing, ThingSchema.parse({
      chainId,
      address: strategy,
      label: 'vault',
      defaults: {
        v3: true,
        erc4626: true,
        apiVersion,
        asset, decimals,
        inceptBlock,
        inceptTime
      }
    }))
  } else {
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
}
