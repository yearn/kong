import { z } from 'zod'
import { parseAbi, toEventSelector } from 'viem'
import { ThingSchema, zhexstring } from 'lib/types'
import { estimateCreationBlock } from 'lib/blocks'
import { mq } from 'lib'
import { rpcs } from '../../../../../../rpcs'
import { extractDecimals, fetchOrExtractAssetAddress, fetchOrExtractErc20 } from '../../../../lib'

export const topics = [
  'event StrategyAdded(address indexed strategy, uint256 debtRatio, uint256 minDebtPerHarvest, uint256 maxDebtPerHarvest, uint256 performanceFee)',
  'event StrategyMigrated(address indexed oldVersion, address indexed newVersion)'
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: object) {
  const vault = address
  const { args } = z.object({
    blockNumber: z.bigint({ coerce: true }),
    args: z.object({
      strategy: zhexstring.optional(),
      newVersion: zhexstring.optional()
    })
  }).parse(data)

  const newStrategy = (args.strategy || args.newVersion)!

  const apiVersion = await rpcs.next(chainId).readContract({
    address: newStrategy,
    functionName: 'apiVersion',
    abi: parseAbi(['function apiVersion() view returns (string)'])
  })

  const asset = await fetchOrExtractAssetAddress(chainId, vault, 'vault', 'token')
  const erc20 = await fetchOrExtractErc20(chainId, asset)
  const decimals = await extractDecimals(chainId, vault)
  const block = await estimateCreationBlock(chainId, newStrategy)
  const inceptBlock = block.number
  const inceptTime = block.timestamp
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: newStrategy,
    label: 'strategy',
    defaults: {
      yearn: true,
      origin: 'yearn',
      vault,
      asset: erc20,
      decimals,
      apiVersion,
      inceptBlock,
      inceptTime
    }
  }))
}
