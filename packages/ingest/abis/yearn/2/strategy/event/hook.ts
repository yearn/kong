import { z } from 'zod'
import { toEventSelector } from 'viem'
import { fetchErc20PriceUsd } from '../../../../../prices'
import { priced } from 'lib/math'
import { fetchOrExtractAssetAddress, fetchOrExtractDecimals, throwOnMulticallError } from '../../../lib'
import { extractTotalDebt } from '../snapshot/hook'
import { rpcs } from '../../../../../rpcs'
import { first } from '../../../../../db'
import { EvmLog, EvmLogSchema, zhexstring } from 'lib/types'
import { math, multicall3 } from 'lib'
import { getBlockTime } from 'lib/blocks'
import strategyAbi from '../abi'
import vaultAbi from '../../vault/abi'

export const topics = [
  'event Harvested(uint256 profit, uint256 loss, uint256 debtPayment, uint256 debtOutstanding)'
].map(e => toEventSelector(e))

export const HarvestSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  args: z.object({
    profit: z.bigint({ coerce: true }),
    loss: z.bigint({ coerce: true }),
    debtPayment: z.bigint({ coerce: true }),
    debtOutstanding: z.bigint({ coerce: true })
  })
})

type Harvest = z.infer<typeof HarvestSchema>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const harvest = HarvestSchema.parse({
    chainId, address, ...data, blockTime: await getBlockTime(chainId, data.blockNumber)
  })

  const decimals = await fetchOrExtractDecimals(chainId, address)
  const asset = await fetchOrExtractAssetAddress(chainId, address, 'strategy', 'want')
  const price = await fetchErc20PriceUsd(chainId, asset, harvest.blockNumber)
  const previousHarvest = await fetchPreviousHarvest(harvest)
  const apr = await computeApr(harvest, previousHarvest)

  return {
    profitUsd: priced(harvest.args.profit, decimals, price.priceUsd),
    lossUsd: priced(harvest.args.loss, decimals, price.priceUsd),
    debtPaymentUsd: priced(harvest.args.debtPayment, decimals, price.priceUsd),
    debtOutstandingUsd: priced(harvest.args.debtOutstanding, decimals, price.priceUsd),
    priceUsd: price.priceUsd,
    priceSource: price.priceSource,
    apr
  }
}

export async function fetchPreviousHarvest(harvest: Harvest) {
  const previousLog = await first<EvmLog>(EvmLogSchema, `
  SELECT * from evmlog
  WHERE chain_id = $1 AND address = $2 AND signature = $3 AND block_number < $4
  ORDER BY block_number DESC, log_index DESC
  LIMIT 1`,
  [harvest.chainId, harvest.address, topics[0], harvest.blockNumber])
  if (!previousLog) return undefined
  return HarvestSchema.parse(previousLog)
}

async function extractVaultAndWant(chainId: number, strategy: `0x${string}`, blockNumber?: bigint) {
  const multicall = await rpcs.next(chainId, blockNumber).multicall({ contracts: [
    { address: strategy, abi: strategyAbi, functionName: 'vault' },
    { address: strategy, abi: strategyAbi, functionName: 'want' }
  ], blockNumber })

  throwOnMulticallError(multicall)

  return {
    vault: multicall[0].result!,
    want: multicall[1].result!
  }
}

export async function extractDebtFromStrategy(chainId: number, strategy: `0x${string}`, blockNumber?: bigint) {
  const { vault, want } = await extractVaultAndWant(chainId, strategy, blockNumber)
  return await extractTotalDebt(chainId, vault, strategy, want, blockNumber)
}

export async function extractDelegatedAssets(chainId: number, strategy: `0x${string}`, blockNumber: bigint) {
  const multicallResult = await rpcs.next(chainId, blockNumber).multicall({ contracts: [
    { address: strategy, abi: strategyAbi, functionName: 'delegatedAssets' }
  ], blockNumber })
  return BigInt(multicallResult[0].result || 0n)
}

export async function extractFees(chainId: number, strategy: `0x${string}`, blockNumber: bigint) {
  const { vault } = await extractVaultAndWant(chainId, strategy, blockNumber)
  const bps = await extractFeesBps(chainId, vault, blockNumber)
  return {
    performance: math.div(bps.performance, 10_000n),
    management: math.div(bps.management, 10_000n)
  }
}

export async function extractFeesBps(chainId: number, vault: `0x${string}`, blockNumber: bigint) {
  const multicallResult = await rpcs.next(chainId, blockNumber).multicall({ contracts: [
    { address: vault, abi: vaultAbi, functionName: 'performanceFee' },
    { address: vault, abi: vaultAbi, functionName: 'managementFee' }
  ], blockNumber })

  return {
    performance: multicallResult[0].result || 0n,
    management: multicallResult[1].result || 0n
  }
}

export async function computeApr(latest: Harvest, previous: Harvest | undefined) {
  if (!previous) return { gross: 0, net: 0 }
  if (!multicall3.supportsBlock(previous.chainId, previous.blockNumber)) return { gross: 0, net: 0 }

  const previousDebt = await extractDebtFromStrategy(previous.chainId, previous.address, previous.blockNumber)
  if (!previousDebt.totalDebt) return { gross: 0, net: 0 }

  const profit = latest.args.profit
  const loss = latest.args.loss

  const performance = (loss > profit)
    ? math.div(-loss, previousDebt.totalDebt)
    : math.div(profit, previousDebt.totalDebt)

  const periodInHours = Number(((latest.blockTime || 0n) - (previous.blockTime || 0n)) / (60n * 60n)) || 1
  const hoursInOneYear = 24 * 365
  const gross = performance * hoursInOneYear / periodInHours

  if(gross < 0) return { gross, net: gross }

  const delegatedAssets = await extractDelegatedAssets(latest.chainId, latest.address, latest.blockNumber)
  const fees = await extractFees(latest.chainId, latest.address, latest.blockNumber)
  const ratioOfDelegatedAssets = math.div(BigInt(delegatedAssets), BigInt(previousDebt.totalDebt))
  const net = gross * (1 - fees.performance) - (fees.management * (1 - ratioOfDelegatedAssets))

  return { gross, net }
}
