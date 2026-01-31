import { z } from 'zod'
import { parseAbi, toEventSelector, zeroAddress } from 'viem'
import { rpcs } from '../../../../../rpcs'
import { EstimatedAprSchema, ThingSchema, TokenMetaSchema, VaultMetaSchema, zhexstring } from 'lib/types'
import db, { getSparkline } from '../../../../../db'
import { fetchErc20PriceUsd } from '../../../../../prices'
import { priced } from 'lib/math'
import { getRiskScore } from '../../../lib/risk'
import { getTokenMeta, getVaultMeta, getStrategyMeta } from '../../../lib/meta'
import { fetchOrExtractErc20, throwOnMulticallError } from '../../../lib'
import { mq } from 'lib'
import { compare } from 'compare-versions'
import { getLatestApy, getLatestEstimatedApr } from '../../../../../helpers/apy-apr'

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



// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const oldold = compare(data.apiVersion, '0.3.1', '<=')
  const strategies = await projectStrategies(chainId, address)
  const withdrawalQueue = await extractWithdrawalQueue(chainId, address)
  const debts = oldold ? [] : await extractDebts(chainId, address)
  const composition = oldold ? [] : await extractComposition(chainId, address, strategies, withdrawalQueue, debts)
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

export async function projectStrategies(chainId: number, vault: `0x${string}`, blockNumber?: bigint) {
  const topics = [
    toEventSelector('event StrategyAdded(address indexed strategy, uint256 debtRatio, uint256 minDebtPerHarvest, uint256 maxDebtPerHarvest, uint256 performanceFee)'),
    toEventSelector('event StrategyMigrated(address indexed oldVersion, address indexed newVersion)'),
    toEventSelector('event StrategyRevoked(address indexed strategy)')
  ]

  const events = await db.query(`
  SELECT signature, args
  FROM evmlog
  WHERE chain_id = $1 AND address = $2 AND signature = ANY($3) AND (block_number <= $4 OR $4 IS NULL)
  ORDER BY block_number ASC, log_index ASC`,
  [chainId, vault, topics, blockNumber])
  if(events.rows.length === 0) return []

  const result: `0x${string}`[] = []

  for (const event of events.rows) {
    switch (event.signature) {
    case topics[0]:
      result.push(zhexstring.parse(event.args.strategy))
      break
    case topics[1]:
      result.push(zhexstring.parse(event.args.newVersion))
      break
    case topics[2]:
      result.splice(result.indexOf(zhexstring.parse(event.args.strategy)), 1)
      break
    }
  }

  return result
}

async function extractDebts(chainId: number, vault: `0x${string}`) {
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

  const snapshot = await db.query(
    `SELECT
      snapshot->'token' AS token,
      snapshot->'decimals' AS decimals,
      hook->'strategies' AS strategies
    FROM snapshot
    WHERE chain_id = $1 AND address = $2`,
    [chainId, vault]
  )

  const { token, decimals, strategies } = z.object({
    token: zhexstring.nullish(),
    decimals: z.number({ coerce: true }).nullish(),
    strategies: zhexstring.array().nullish()
  }).parse(snapshot.rows[0] || {})

  if (!(token && decimals && strategies) || strategies.length === 0) return []

  const abi = parseAbi(['function strategies(address) view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)'])
  const multicall = await rpcs.next(chainId).multicall({ contracts: strategies.map(strategy => ({
    address: vault, functionName: 'strategies', args: [strategy], abi
  })) })

  throwOnMulticallError(multicall)

  for (let i = 0; i < strategies.length; i++) {
    const [
      performanceFee,
      activation,
      debtRatio,
      minDebtPerHarvest,
      maxDebtPerHarvest,
      lastReport,
      totalDebt,
      totalGain,
      totalLoss
    ] = multicall[i].result!

    const { priceUsd } = await fetchErc20PriceUsd(chainId, token)
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
  debts: Awaited<ReturnType<typeof extractDebts>>
) {
  // Batch-fetch strategy snapshots for name and APR
  const strategySnapshots = await fetchStrategySnapshots(chainId, strategies)

  const composition: z.infer<typeof CompositionSchema>[] = []

  for (const strategy of strategies) {
    const debt = debts.find(d => d.strategy === strategy)
    const snapshot = strategySnapshots.find(s => s.address.toLowerCase() === strategy.toLowerCase())

    // Fetch strategy metadata (try vault meta first for dual-role addresses)
    const vaultMeta = await getVaultMeta(chainId, strategy)
    const meta = vaultMeta?.displayName ? vaultMeta : await getStrategyMeta(chainId, strategy)

    // Coalesce name: meta.name → snapshot.name → "Unknown"
    const name = meta?.displayName || snapshot?.name || 'Unknown'

    // Parse latestReportApr
    const latestReportApr = snapshot?.latestReportApr ? parseFloat(snapshot.latestReportApr) : null

    // Compute status based on debt and withdrawal queue membership
    let status: 'active' | 'inactive' | 'unallocated'
    const isInQueue = withdrawalQueue.some(addr => addr.toLowerCase() === strategy.toLowerCase())
    const hasDebt = debt && debt.totalDebt > 0n && debt.debtRatio > 0n

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
