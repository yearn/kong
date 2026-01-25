import { z } from 'zod'
import { parseAbi, toEventSelector, zeroAddress } from 'viem'
import { rpcs } from '../../../../../rpcs'
import { EstimatedAprSchema, ThingSchema, TokenMetaSchema, VaultMetaSchema, zhexstring } from 'lib/types'
import db, { getLatestApy, getSparkline, firstRow } from '../../../../../db'
import { fetchErc20PriceUsd } from '../../../../../prices'
import { priced } from 'lib/math'
import { getRiskScore } from '../../../lib/risk'
import { getTokenMeta, getVaultMeta } from '../../../lib/meta'
import { fetchOrExtractErc20, throwOnMulticallError } from '../../../lib'
import { mq } from 'lib'
import { compare } from 'compare-versions'

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
  meta: VaultMetaSchema.merge(z.object({ token: TokenMetaSchema }))
})


async function getLatestEstimatedApr(chainId: number, address: string) {
  const result = await firstRow(`
  SELECT
    chain_id as "chainId",
    address,
    label,
    MAX(CASE WHEN component = 'netAPR' THEN value END) AS apr,
    MAX(CASE WHEN component = 'netAPY' THEN value END) AS apy,
    MAX(CASE WHEN component = 'boost' THEN value END) AS boost,
    MAX(CASE WHEN component = 'poolAPY' THEN value END) AS "poolAPY",
    MAX(CASE WHEN component = 'boostedAPR' THEN value END) AS "boostedAPR",
    MAX(CASE WHEN component = 'baseAPR' THEN value END) AS "baseAPR",
    MAX(CASE WHEN component = 'rewardsAPR' THEN value END) AS "rewardsAPR",
    MAX(CASE WHEN component = 'rewardsAPY' THEN value END) AS "rewardsAPY",
    MAX(CASE WHEN component = 'cvxAPR' THEN value END) AS "cvxAPR",
    MAX(CASE WHEN component = 'keepCRV' THEN value END) AS "keepCRV",
    MAX(CASE WHEN component = 'keepVelo' THEN value END) AS "keepVelo",
    block_number as "blockNumber",
    block_time as "blockTime"
  FROM output
  WHERE block_time = (
      SELECT MAX(block_time) FROM output
      WHERE chain_id = $1
      AND LOWER(address) = LOWER($2)
      AND label IN ('crv-estimated-apr', 'velo-estimated-apr', 'aero-estimated-apr')
    )
    AND chain_id = $1
    AND LOWER(address) = LOWER($2)
    AND label IN ('crv-estimated-apr', 'velo-estimated-apr', 'aero-estimated-apr')
  GROUP BY chain_id, address, label, block_number, block_time;
  `, [chainId, address])

  if (!result) return undefined

  let type = 'unknown'
  if (result.label === 'crv-estimated-apr') type = 'crv'
  if (result.label === 'velo-estimated-apr') type = 'velo'
  if (result.label === 'aero-estimated-apr') type = 'aero'

  return EstimatedAprSchema.parse({
    apr: result.apr || 0,
    apy: result.apy || 0,
    type,
    components: {
      boost: result.boost,
      poolAPY: result.poolAPY,
      boostedAPR: result.boostedAPR,
      baseAPR: result.baseAPR,
      rewardsAPR: result.rewardsAPR,
      rewardsAPY: result.rewardsAPY,
      cvxAPR: result.cvxAPR,
      keepCRV: result.keepCRV,
      keepVelo: result.keepVelo
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const oldold = compare(data.apiVersion, '0.3.1', '<=')
  const strategies = await projectStrategies(chainId, address)
  const withdrawalQueue = await extractWithdrawalQueue(chainId, address)
  const debts = oldold ? [] : await extractDebts(chainId, address)
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
    risk,
    meta: { ...meta, token },
    sparklines,
    tvl: sparklines.tvl[0],
    apy,
    performance: {
      estimated,
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
