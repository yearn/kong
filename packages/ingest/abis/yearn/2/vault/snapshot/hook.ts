import { compare } from 'compare-versions'
import { mq } from 'lib'
import { priced } from 'lib/math'
import { EstimatedAprSchema, ThingSchema, TokenMetaSchema, VaultMetaSchema, zhexstring } from 'lib/types'
import { parseAbi, toEventSelector, zeroAddress } from 'viem'
import { z } from 'zod'
import db, { getSparkline } from '../../../../../db'
import { getLatestApy, getLatestEstimatedApr } from '../../../../../helpers/apy-apr'
import { fetchErc20PriceUsd } from '../../../../../prices'
import { rpcs } from '../../../../../rpcs'
import { fetchOrExtractErc20, throwOnMulticallError } from '../../../lib'
import { getStrategyMeta, getTokenMeta, getVaultMeta } from '../../../lib/meta'
import { getRiskScore } from '../../../lib/risk'

export const CompositionSchema = z.object({
  address: zhexstring,
  name: z.string(),
  status: z.enum(['active', 'inactive', 'unallocated']),
  latestReportApr: z.number().nullish(),
  performanceFee: z.bigint(),
  activation: z.bigint(),
  debtRatio: z.bigint(),
  minDebtPerHarvest: z.bigint(),
  maxDebtPerHarvest: z.bigint(),
  lastReport: z.bigint(),
  totalDebt: z.bigint(),
  totalDebtUsd: z.number(),
  totalGain: z.bigint(),
  totalGainUsd: z.number(),
  totalLoss: z.bigint(),
  totalLossUsd: z.number(),
  performance: z.object({
    estimated: EstimatedAprSchema.nullish(),
    oracle: z.object({
      apr: z.number().nullish(),
      apy: z.number().nullish()
    }).nullish(),
    historical: z.object({
      net: z.number().nullish(),
      weeklyNet: z.number().nullish(),
      monthlyNet: z.number().nullish(),
      inceptionNet: z.number().nullish()
    }).nullish()
  }).nullish()
})

export const ResultSchema = z.object({
  strategies: z.array(zhexstring),
  withdrawalQueue: z.array(zhexstring),
  debts: z.array(z.object({
    strategy: zhexstring,
    performanceFee: z.bigint(),
    activation: z.bigint(),
    debtRatio: z.bigint(),
    minDebtPerHarvest: z.bigint(),
    maxDebtPerHarvest: z.bigint(),
    lastReport: z.bigint(),
    totalDebt: z.bigint(),
    totalDebtUsd: z.number(),
    totalGain: z.bigint(),
    totalGainUsd: z.number(),
    totalLoss: z.bigint(),
    totalLossUsd: z.number()
  })),
  composition: CompositionSchema.array(),
  meta: VaultMetaSchema.merge(z.object({ token: TokenMetaSchema }))
})



export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { strategies: projected, revoked } = await projectStrategyEvents(chainId, address)
  const withdrawalQueue = await extractWithdrawalQueue(chainId, address)
  const candidates = union(projected, withdrawalQueue, revoked)
  const allDebts = await extractDebts(chainId, address, data, candidates)
  const strategies = resolveStrategies(projected, withdrawalQueue, revoked, allDebts)
  const debts = allDebts.filter(d => strategies.some(s => s.toLowerCase() === d.strategy.toLowerCase()))
  const composition = await extractComposition(chainId, address, strategies, withdrawalQueue, debts, data.apiVersion)
  const risk = await getRiskScore(chainId, address)
  const meta = await getVaultMeta(chainId, address)
  const token = await getTokenMeta(chainId, data.token)

  const erc20 = await fetchOrExtractErc20(chainId, data.token)
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: data.token, label: 'erc20', defaults: erc20
  }))

  const sparklines = {
    tvl: await getSparkline(chainId, address, 'tvl-c', 'tvl'),
    apy: await getSparkline(chainId, address, 'apy-bwd-delta-pps', 'net')
  }

  const apy = await getLatestApy(chainId, address)
  const estimated = await getLatestEstimatedApr(chainId, address)

  // Query DB for staking pool associated with this vault
  const stakingPool = await db.query(`
    SELECT s.hook FROM snapshot s
    JOIN thing t ON s.chain_id = t.chain_id AND s.address = t.address
    WHERE t.label = 'stakingPool'
      AND t.chain_id = $1
      AND t.defaults->>'vault' = $2
    ORDER BY (t.defaults->>'inceptBlock')::bigint ASC
    LIMIT 1
  `, [chainId, address])

  return {
    asset: erc20,
    strategies,
    withdrawalQueue,
    debts,
    composition,
    risk,
    meta: { ...meta, token },
    sparklines,
    tvl: sparklines.tvl[0],
    apy,
    performance: {
      estimated,
      oracle: undefined,
      historical: apy ? {
        net: apy.net,
        weeklyNet: apy.weeklyNet,
        monthlyNet: apy.monthlyNet,
        inceptionNet: apy.inceptionNet
      } : undefined
    },
    staking: stakingPool?.rows[0]?.hook ?? { available: false, rewards: [] }
  }
}

export function union(...lists: `0x${string}`[][]) {
  const result: `0x${string}`[] = []
  for (const list of lists) {
    for (const address of list) {
      if (!result.some(a => a.toLowerCase() === address.toLowerCase())) result.push(address)
    }
  }
  return result
}

export async function projectStrategyEvents(chainId: number, vault: `0x${string}`, blockNumber?: bigint) {
  const topics = [
    toEventSelector('event StrategyAdded(address indexed strategy, uint256 debtRatio, uint256 minDebtPerHarvest, uint256 maxDebtPerHarvest, uint256 performanceFee)'),
    toEventSelector('event StrategyMigrated(address indexed oldVersion, address indexed newVersion)'),
    toEventSelector('event StrategyRevoked(address indexed strategy)'),
    toEventSelector('event StrategyAdded(address indexed strategy, uint256 debtRatio, uint256 rateLimit, uint256 performanceFee)')
  ]

  const events = await db.query(`
  SELECT signature, args->>'strategy' AS strategy, args->>'newVersion' AS "newVersion"
  FROM evmlog
  WHERE chain_id = $1 AND address = $2 AND signature = ANY($3) AND (block_number <= $4 OR $4 IS NULL)
  ORDER BY block_number ASC, log_index ASC`,
  [chainId, vault, topics, blockNumber])

  const strategies: `0x${string}`[] = []
  const revoked: `0x${string}`[] = []

  const add = (list: `0x${string}`[], address: `0x${string}`) => {
    if (!list.some(a => a.toLowerCase() === address.toLowerCase())) list.push(address)
  }

  const remove = (list: `0x${string}`[], address: `0x${string}`) => {
    const index = list.findIndex(a => a.toLowerCase() === address.toLowerCase())
    if (index >= 0) list.splice(index, 1)
  }

  for (const event of events.rows) {
    switch (event.signature) {
    case topics[0]:
    case topics[3]: {
      const strategy = zhexstring.parse(event.strategy)
      add(strategies, strategy)
      remove(revoked, strategy)
      break
    }
    case topics[1]: {
      const newVersion = zhexstring.parse(event.newVersion)
      add(strategies, newVersion)
      remove(revoked, newVersion)
      break
    }
    case topics[2]: {
      const strategy = zhexstring.parse(event.strategy)
      remove(strategies, strategy)
      add(revoked, strategy)
      break
    }
    }
  }

  return { strategies, revoked }
}

export async function projectStrategies(chainId: number, vault: `0x${string}`, blockNumber?: bigint) {
  return (await projectStrategyEvents(chainId, vault, blockNumber)).strategies
}

// revoked strategies stay listed only while they still carry debt, so residual
// debt is not silently dropped and sums still reconcile to vault totalDebt
export function resolveStrategies(
  projected: `0x${string}`[],
  withdrawalQueue: `0x${string}`[],
  revoked: `0x${string}`[],
  debts: { strategy: `0x${string}`, totalDebt: bigint }[]
) {
  const residuals = revoked.filter(r =>
    (debts.find(d => d.strategy.toLowerCase() === r.toLowerCase())?.totalDebt ?? 0n) > 0n
  )
  return union(projected, withdrawalQueue, residuals)
}

export function mapStrategyParams(apiVersion: string, fields: readonly bigint[]) {
  if (compare(apiVersion, '0.3.2', '<')) {
    const [performanceFee, activation, debtRatioOrLimit, , lastReport, totalDebt, totalGain, totalLoss] = fields
    // pre-0.3.0 field 3 is debtLimit, an absolute token amount, not bps — don't publish it as debtRatio
    const debtRatio = compare(apiVersion, '0.3.0', '<') ? 0n : debtRatioOrLimit
    return { performanceFee, activation, debtRatio, minDebtPerHarvest: 0n, maxDebtPerHarvest: 0n, lastReport, totalDebt, totalGain, totalLoss }
  }
  const [performanceFee, activation, debtRatio, minDebtPerHarvest, maxDebtPerHarvest, lastReport, totalDebt, totalGain, totalLoss] = fields
  return { performanceFee, activation, debtRatio, minDebtPerHarvest, maxDebtPerHarvest, lastReport, totalDebt, totalGain, totalLoss }
}

async function extractDebts(chainId: number, vault: `0x${string}`, data: any, strategies: `0x${string}`[]) {
  const results = z.object({
    strategy: zhexstring,
    performanceFee: z.bigint({ coerce: true }),
    activation: z.bigint({ coerce: true }),
    debtRatio: z.bigint({ coerce: true }),
    minDebtPerHarvest: z.bigint({ coerce: true }),
    maxDebtPerHarvest: z.bigint({ coerce: true }),
    lastReport: z.bigint({ coerce: true }),
    totalDebt: z.bigint({ coerce: true }),
    totalDebtUsd: z.number(),
    totalGain: z.bigint({ coerce: true }),
    totalGainUsd: z.number(),
    totalLoss: z.bigint({ coerce: true }),
    totalLossUsd: z.number()
  }).array().parse([])

  const { apiVersion, token, decimals } = z.object({
    apiVersion: z.string(),
    token: zhexstring.nullish(),
    decimals: z.number({ coerce: true }).nullish()
  }).parse({ apiVersion: data.apiVersion, token: data.token, decimals: data.decimals })

  if (token == null || decimals == null || strategies.length === 0) return []

  const abi = compare(apiVersion, '0.3.2', '<')
    ? parseAbi(['function strategies(address) view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)'])
    : parseAbi(['function strategies(address) view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)'])

  const multicall = await rpcs.next(chainId).multicall({ contracts: strategies.map(strategy => ({
    address: vault, functionName: 'strategies', args: [strategy], abi
  })) })

  throwOnMulticallError(multicall)

  const { priceUsd } = await fetchErc20PriceUsd(chainId, token)

  for (let i = 0; i < strategies.length; i++) {
    const {
      performanceFee,
      activation,
      debtRatio,
      minDebtPerHarvest,
      maxDebtPerHarvest,
      lastReport,
      totalDebt,
      totalGain,
      totalLoss
    } = mapStrategyParams(apiVersion, multicall[i].result!)

    const totalDebtUsd = priced(totalDebt, decimals, priceUsd)
    const totalGainUsd = priced(totalGain, decimals, priceUsd)
    const totalLossUsd = priced(totalLoss, decimals, priceUsd)

    results.push({
      strategy: strategies[i],
      performanceFee,
      activation,
      debtRatio,
      minDebtPerHarvest,
      maxDebtPerHarvest,
      lastReport,
      totalDebt,
      totalDebtUsd,
      totalGain,
      totalGainUsd,
      totalLoss,
      totalLossUsd
    })
  }

  return results
}

export async function extractWithdrawalQueue(chainId: number, address: `0x${string}`, blockNumber?: bigint) {
  const abi = parseAbi(['function withdrawalQueue(uint256) view returns (address)'])

  const multicall = await rpcs.next(chainId, blockNumber).multicall({ contracts: [
    { args: [0n], address, functionName: 'withdrawalQueue', abi },
    { args: [1n], address, functionName: 'withdrawalQueue', abi },
    { args: [2n], address, functionName: 'withdrawalQueue', abi },
    { args: [3n], address, functionName: 'withdrawalQueue', abi },
    { args: [4n], address, functionName: 'withdrawalQueue', abi },
    { args: [5n], address, functionName: 'withdrawalQueue', abi },
    { args: [6n], address, functionName: 'withdrawalQueue', abi },
    { args: [7n], address, functionName: 'withdrawalQueue', abi },
    { args: [8n], address, functionName: 'withdrawalQueue', abi },
    { args: [9n], address, functionName: 'withdrawalQueue', abi },
    { args: [10n], address, functionName: 'withdrawalQueue', abi },
    { args: [11n], address, functionName: 'withdrawalQueue', abi },
    { args: [12n], address, functionName: 'withdrawalQueue', abi },
    { args: [13n], address, functionName: 'withdrawalQueue', abi },
    { args: [14n], address, functionName: 'withdrawalQueue', abi },
    { args: [15n], address, functionName: 'withdrawalQueue', abi },
    { args: [16n], address, functionName: 'withdrawalQueue', abi },
    { args: [17n], address, functionName: 'withdrawalQueue', abi },
    { args: [18n], address, functionName: 'withdrawalQueue', abi },
    { args: [19n], address, functionName: 'withdrawalQueue', abi }
  ], blockNumber })

  return multicall.filter(result => result.status === 'success' && result.result && result.result !== zeroAddress)
    .map(result => result.result as `0x${string}`)
}

async function fetchStrategySnapshots(chainId: number, strategies: `0x${string}`[]) {
  if (strategies.length === 0) return []

  const result = await db.query(`
    SELECT
      address,
      snapshot->>'name' as name,
      hook->'lastReportDetail'->'apr'->>'net' as "latestReportApr",
      hook->'performance' as performance
    FROM snapshot
    WHERE chain_id = $1 AND address = ANY($2)
  `, [chainId, strategies])

  return z.object({
    address: zhexstring,
    name: z.string().nullable(),
    latestReportApr: z.string().nullable(),
    performance: z.object({
      estimated: EstimatedAprSchema.nullish(),
      oracle: z.object({
        apr: z.number().nullish(),
        apy: z.number().nullish()
      }).nullish(),
      historical: z.object({
        net: z.number().nullish(),
        weeklyNet: z.number().nullish(),
        monthlyNet: z.number().nullish(),
        inceptionNet: z.number().nullish()
      }).nullish()
    }).nullish()
  }).array().parse(result.rows)
}

export async function extractComposition(
  chainId: number,
  vault: `0x${string}`,
  strategies: `0x${string}`[],
  withdrawalQueue: `0x${string}`[],
  debts: Awaited<ReturnType<typeof extractDebts>>,
  apiVersion: string
) {
  // Batch-fetch strategy snapshots for name and APR
  const strategySnapshots = await fetchStrategySnapshots(chainId, strategies)

  const composition: z.infer<typeof CompositionSchema>[] = []

  // pre-0.3.0 vaults have no debtRatio, so queue membership stands in for it
  const ratioless = compare(apiVersion, '0.3.0', '<')

  for (const strategy of strategies) {
    const debt = debts.find(d => d.strategy.toLowerCase() === strategy.toLowerCase())
    const snapshot = strategySnapshots.find(s => s.address.toLowerCase() === strategy.toLowerCase())

    // Fetch strategy metadata (try vault meta first for dual-role addresses)
    const vaultMeta = await getVaultMeta(chainId, strategy)
    const meta = vaultMeta?.displayName ? vaultMeta : await getStrategyMeta(chainId, strategy)

    // Coalesce name: snapshot.name → meta.name → "Unknown"
    const name =  snapshot?.name || meta?.displayName || 'Unknown'

    // Parse latestReportApr
    const latestReportApr = snapshot?.latestReportApr ? parseFloat(snapshot.latestReportApr) : null

    // Compute status based on debt and withdrawal queue membership
    let status: 'active' | 'inactive' | 'unallocated'
    const isInQueue = withdrawalQueue.some(addr => addr.toLowerCase() === strategy.toLowerCase())
    const hasDebt = debt && debt.totalDebt > 0n && (debt.debtRatio > 0n || (ratioless && isInQueue))

    if (hasDebt) {
      status = 'active'
    } else if (isInQueue) {
      status = 'inactive'
    } else {
      status = 'unallocated'
    }

    composition.push({
      address: strategy,
      name,
      status,
      latestReportApr,
      performanceFee: debt?.performanceFee ?? 0n,
      activation: debt?.activation ?? 0n,
      debtRatio: debt?.debtRatio ?? 0n,
      minDebtPerHarvest: debt?.minDebtPerHarvest ?? 0n,
      maxDebtPerHarvest: debt?.maxDebtPerHarvest ?? 0n,
      lastReport: debt?.lastReport ?? 0n,
      totalDebt: debt?.totalDebt ?? 0n,
      totalDebtUsd: debt?.totalDebtUsd ?? 0,
      totalGain: debt?.totalGain ?? 0n,
      totalGainUsd: debt?.totalGainUsd ?? 0,
      totalLoss: debt?.totalLoss ?? 0n,
      totalLossUsd: debt?.totalLossUsd ?? 0,
      performance: snapshot?.performance ?? undefined
    })
  }

  return CompositionSchema.array().parse(composition)
}
