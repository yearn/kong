import { z } from 'zod'
import { parseAbi, toEventSelector } from 'viem'
import { priced } from 'lib/math'
import { fetchOrExtractAssetAddress, fetchOrExtractDecimals } from '../../../lib'
import { fetchErc20PriceUsd } from '../../../../../prices'
import { math, multicall3 } from 'lib'
import { rpcs } from '../../../../../rpcs'
import { first } from '../../../../../db'
import { EvmLog, EvmLogSchema, zhexstring } from 'lib/types'
import { getBlockTime } from 'lib/blocks'

export const topics = [
  'event Reported(uint256 profit, uint256 loss, uint256 protocolFees, uint256 performanceFees)'
].map(e => toEventSelector(e))

export const HarvestSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  args: z.object({
    profit: z.bigint({ coerce: true }),
    loss: z.bigint({ coerce: true }),
    protocolFees: z.bigint({ coerce: true }),
    performanceFees: z.bigint({ coerce: true })
  })
})

export type Harvest = z.infer<typeof HarvestSchema>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const latestHarvest = HarvestSchema.parse({
    chainId, address, blockTime: await getBlockTime(chainId, data.blockNumber), ...data
  })

  const decimals = await fetchOrExtractDecimals(chainId, address)
  const asset = await fetchOrExtractAssetAddress(chainId, address, 'strategy', 'asset')
  const price = await fetchErc20PriceUsd(chainId, asset, latestHarvest.blockNumber)

  const previousLog = await first<EvmLog>(EvmLogSchema, `
  SELECT * from evmlog
  WHERE chain_id = $1 AND address = $2 AND signature = $3 AND block_number < $4
  ORDER BY block_number DESC, log_index DESC LIMIT 1`,
  [chainId, address, topics[0], latestHarvest.blockNumber])
  const previousHarvest = previousLog ? HarvestSchema.parse(previousLog) : undefined
  const apr = multicall3.supportsBlock(chainId, data.blockNumber)
    ? await computeApr(latestHarvest, previousHarvest)
    : { gross: 0, net: 0 }

  return {
    profitUsd: priced(latestHarvest.args.profit, decimals, price.priceUsd),
    lossUsd: priced(latestHarvest.args.loss, decimals, price.priceUsd),
    protocolFeesUsd: priced(latestHarvest.args.protocolFees, decimals, price.priceUsd),
    performanceFeesUsd: priced(latestHarvest.args.performanceFees, decimals, price.priceUsd),
    priceUsd: price.priceUsd,
    priceSource: price.priceSource,
    apr
  }
}

export async function totalAssets(harvest: Harvest) {
  try {
    return await rpcs.next(harvest.chainId, harvest.blockNumber).readContract({
      address: harvest.address,
      functionName: 'totalAssets',
      abi: parseAbi(['function totalAssets() view returns (uint256)']),
      blockNumber: harvest.blockNumber
    }) as bigint
  } catch(error) {
    console.error('🤬', '!totalAssets')
    return 0n
  }
}

export async function computeApr(latest: Harvest, previous: Harvest | undefined) {
  if(!previous) return { gross: 0, net: 0 }
  const latestAssets = await totalAssets(latest)
  const previousAssets = await totalAssets(previous)

  if(!(latestAssets && previousAssets)) return { gross: 0, net: 0 }

  const profit = latest.args.profit
  const loss = latest.args.loss
  const fees = latest.args.performanceFees ?? 0n

  const grossPerformance = (loss > profit)
    ? math.div(-loss, previousAssets)
    : math.div(profit, previousAssets)

  const netPerformance = (loss > profit)
    ? math.div(-loss, previousAssets)
    : math.div(math.max(profit - fees, 0n), previousAssets)

  const periodInHours = Number(((latest.blockTime || 0n) - (previous.blockTime || 0n)) / (60n * 60n)) || 1
  const hoursInOneYear = 24 * 365
  const gross = grossPerformance * hoursInOneYear / periodInHours
  const net = netPerformance * hoursInOneYear / periodInHours

  return { gross, net }
}
