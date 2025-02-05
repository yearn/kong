import { z } from 'zod'
import { toEventSelector } from 'viem'
import { fetchOrExtractAssetAddress, fetchOrExtractDecimals } from '../../../../lib'
import { fetchErc20PriceUsd } from '../../../../../../prices'
import { priced } from 'lib/math'
import { EvmAddressSchema, EvmLog, EvmLogSchema } from 'lib/types'
import { getBlockTime } from 'lib/blocks'
import { first } from '../../../../../../db'
import { math, multicall3 } from 'lib'
import { extractDebtFromStrategy, extractDelegatedAssets, extractFees } from '../../../strategy/event/hook'

export const topics = [
  'event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 debtPaid, uint256 totalGain, uint256 totalLoss, uint256 totalDebt, uint256 debtAdded, uint256 debtRatio)'
].map(e => toEventSelector(e))

export const HarvestSchema = z.object({
  chainId: z.number(),
  address: EvmAddressSchema,
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  args: z.object({
    strategy: EvmAddressSchema,
    gain: z.bigint({ coerce: true }),
    loss: z.bigint({ coerce: true }),
    debtPaid: z.bigint({ coerce: true }),
    totalGain: z.bigint({ coerce: true }),
    totalLoss: z.bigint({ coerce: true }),
    totalDebt: z.bigint({ coerce: true }),
    debtAdded: z.bigint({ coerce: true }),
    debtRatio: z.bigint({ coerce: true })
  })
})

export type Harvest = z.infer<typeof HarvestSchema>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const harvest = HarvestSchema.parse({
    chainId, address, blockTime: await getBlockTime(chainId, data.blockNumber), ...data
  })

  const decimals = await fetchOrExtractDecimals(chainId, address)
  const asset = await fetchOrExtractAssetAddress(chainId, address, 'vault', 'token')
  const price = await fetchErc20PriceUsd(chainId, asset, harvest.blockNumber)
  const previousHarvest = await fetchPreviousHarvest(harvest)
  const apr = await computeApr(harvest, previousHarvest)

  return {
    gainUsd: priced(harvest.args.gain, decimals, price.priceUsd),
    lossUsd: priced(harvest.args.loss, decimals, price.priceUsd),
    debtPaidUsd: priced(harvest.args.debtPaid, decimals, price.priceUsd),
    totalGainUsd: priced(harvest.args.totalGain, decimals, price.priceUsd),
    totalLossUsd: priced(harvest.args.totalLoss, decimals, price.priceUsd),
    totalDebtUsd: priced(harvest.args.totalDebt, decimals, price.priceUsd),
    debtAddedUsd: priced(harvest.args.debtAdded, decimals, price.priceUsd),
    priceUsd: price.priceUsd,
    priceSource: price.priceSource,
    apr
  }
}

async function fetchPreviousHarvest(harvest: Harvest) {
  const previousLog = await first<EvmLog>(EvmLogSchema, `
  SELECT * from evmlog
  WHERE
    chain_id = $1
    AND address = $2
    AND signature = $3
    AND block_number < $4
    AND args->>'strategy' = $5
  ORDER BY block_number DESC, log_index DESC
  LIMIT 1`,
  [harvest.chainId, harvest.address, topics[0], harvest.blockNumber, harvest.args.strategy])
  if (!previousLog) return undefined
  return HarvestSchema.parse(previousLog)
}

export async function computeApr(latest: Harvest, previous: Harvest | undefined) {
  if (!previous) return { gross: 0, net: 0 }
  if (!multicall3.supportsBlock(previous.chainId, previous.blockNumber)) return { gross: 0, net: 0 }

  const previousDebt = await extractDebtFromStrategy(previous.chainId, previous.args.strategy, previous.blockNumber)
  if (!previousDebt.totalDebt) return { gross: 0, net: 0 }

  const profit = latest.args.gain
  const loss = latest.args.loss

  const performance = (loss > profit)
    ? math.div(-loss, previousDebt.totalDebt)
    : math.div(profit, previousDebt.totalDebt)

  const periodInHours = Number(((latest.blockTime || 0n) - (previous.blockTime || 0n)) / (60n * 60n)) || 1
  const hoursInOneYear = 24 * 365
  const gross = performance * hoursInOneYear / periodInHours

  if(gross < 0) return { gross, net: gross }

  const delegatedAssets = await extractDelegatedAssets(latest.chainId, latest.args.strategy, latest.blockNumber)
  const fees = await extractFees(latest.chainId, latest.args.strategy, latest.blockNumber)
  const ratioOfDelegatedAssets = math.div(BigInt(delegatedAssets), BigInt(previousDebt.totalDebt))
  const net = gross * (1 - fees.performance) - (fees.management * (1 - ratioOfDelegatedAssets))

  return { gross, net }
}
