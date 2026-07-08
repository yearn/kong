import { EstimatedAprSchema } from 'lib/types'
import type { EstimatedApr } from 'lib/types'
import { getLatestEstimatedAprRows } from 'lib/estimated-apr'
import { z } from 'zod'
import db, { firstRow } from '../db'
import { parsePositiveIntDays } from './env'

const CURRENT_PERFORMANCE_LOOKBACK_DAYS = parsePositiveIntDays('CURRENT_PERFORMANCE_LOOKBACK_DAYS', 7)

const ESTIMATED_APR_PROMOTED_COMPONENTS = ['apr', 'apy', 'grossAPR', 'grossAPY', 'netAPR', 'netAPY'] as const

type EstimatedAprPromotedComponent = typeof ESTIMATED_APR_PROMOTED_COMPONENTS[number]

export function promoteEstimatedAprComponents(
  type: string,
  components: Record<string, number>
): EstimatedApr {
  const promoted = Object.fromEntries(
    ESTIMATED_APR_PROMOTED_COMPONENTS.map(component => [component, components[component]])
      .filter(([, value]) => value != null)
  ) as Partial<Record<EstimatedAprPromotedComponent, number>>

  const rest = Object.fromEntries(
    Object.entries(components).filter(([component]) =>
      !ESTIMATED_APR_PROMOTED_COMPONENTS.includes(component as EstimatedAprPromotedComponent)
    )
  )

  return EstimatedAprSchema.parse({
    type,
    ...(promoted.apr != null ? { apr: promoted.apr } : promoted.netAPR != null ? { apr: promoted.netAPR } : {}),
    ...(promoted.apy != null ? { apy: promoted.apy } : promoted.netAPY != null ? { apy: promoted.netAPY } : {}),
    ...(promoted.grossAPR != null ? { grossAPR: promoted.grossAPR } : {}),
    ...(promoted.grossAPY != null ? { grossAPY: promoted.grossAPY } : {}),
    ...(promoted.netAPR != null ? { netAPR: promoted.netAPR } : {}),
    ...(promoted.netAPY != null ? { netAPY: promoted.netAPY } : {}),
    components: rest
  })
}

export async function getLatestEstimatedAprV3(chainId: number, address: string, label?: string) {
  const rows = await getLatestEstimatedAprRows(db, chainId, address, {
    label,
    maxAgeDays: CURRENT_PERFORMANCE_LOOKBACK_DAYS,
  })

  if (!rows.length) return undefined

  const components: Record<string, number> = {}
  for (const row of rows) {
    if (row.value != null && row.component != null) components[row.component] = row.value
  }

  return promoteEstimatedAprComponents(rows[0].label, components)
}

export async function getLatestEstimatedApr(chainId: number, address: string) {
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
  -- series_time floor only prunes hypertable chunks; series_time >= block_time
  -- always holds, so it never drops a row the block_time bound keeps.
  WHERE series_time > NOW() - make_interval(days => $3::int)
    AND block_time = (
      SELECT MAX(block_time) FROM output
      WHERE chain_id = $1
      AND address = $2
      AND label IN ('crv-estimated-apr', 'velo-estimated-apr', 'aero-estimated-apr')
      AND series_time > NOW() - make_interval(days => $3::int)
      AND block_time > NOW() - make_interval(days => $3::int)
    )
    AND chain_id = $1
    AND address = $2
    AND label IN ('crv-estimated-apr', 'velo-estimated-apr', 'aero-estimated-apr')
  GROUP BY chain_id, address, label, block_number, block_time;
  `, [chainId, address, CURRENT_PERFORMANCE_LOOKBACK_DAYS])

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

export async function getLatestApy(chainId: number, address: string) {
  const first = await firstRow(`
  SELECT
    chain_id as "chainId",
    address,
    label,
    MAX(CASE WHEN component = 'net' THEN value END) AS net,
    MAX(CASE WHEN component = 'weeklyNet' THEN value END) AS "weeklyNet",
    MAX(CASE WHEN component = 'monthlyNet' THEN value END) AS "monthlyNet",
    MAX(CASE WHEN component = 'inceptionNet' THEN value END) AS "inceptionNet",
    MAX(CASE WHEN component = 'grossApr' THEN value END) AS "grossApr",
    MAX(CASE WHEN component = 'pricePerShare' THEN value END) AS "pricePerShare",
    MAX(CASE WHEN component = 'weeklyPricePerShare' THEN value END) AS "weeklyPricePerShare",
    MAX(CASE WHEN component = 'monthlyPricePerShare' THEN value END) AS "monthlyPricePerShare",
    block_number as "blockNumber",
    block_time as "blockTime"
  FROM output
  -- series_time floor only prunes hypertable chunks; series_time >= block_time
  -- always holds, so it never drops a row the block_time bound keeps.
  WHERE series_time > NOW() - make_interval(days => $3::int)
    AND block_time = (
      SELECT MAX(block_time) FROM output
      WHERE chain_id = $1
      AND address = $2
      AND label = 'apy-bwd-delta-pps'
      AND series_time > NOW() - make_interval(days => $3::int)
      AND block_time > NOW() - make_interval(days => $3::int)
    )
    AND chain_id = $1
    AND address = $2
    AND label = 'apy-bwd-delta-pps'
  GROUP BY chain_id, address, label, block_number, block_time;
  `, [chainId, address, CURRENT_PERFORMANCE_LOOKBACK_DAYS])

  if (!first) return undefined

  return z.object({
    chainId: z.number().default(chainId),
    address: z.string().default(address),
    label: z.string().default('apy-bwd-delta-pps'),
    net: z.number().nullish(),
    weeklyNet: z.number().nullish(),
    monthlyNet: z.number().nullish(),
    inceptionNet: z.number().nullish(),
    grossApr: z.number().nullish(),
    pricePerShare: z.bigint({ coerce: true }).nullish(),
    weeklyPricePerShare: z.bigint({ coerce: true }).nullish(),
    monthlyPricePerShare: z.bigint({ coerce: true }).nullish(),
    blockNumber: z.bigint({ coerce: true }),
    blockTime: z.bigint({ coerce: true })
  }).parse(first)
}

export async function getLatestOracleApr(chainId: number, address: string): Promise<[number, number, string?]> {
  const result = await firstRow(`
  SELECT
    chain_id as "chainId",
    address,
    label,
    MAX(CASE WHEN component = 'apr' THEN value END) AS apr,
    MAX(CASE WHEN component = 'apy' THEN value END) AS apy,
    MAX(CASE WHEN component = 'source:getStrategyApr' THEN 'getStrategyApr'
             WHEN component = 'source:getCurrentApr' THEN 'getCurrentApr' END) AS source,
    block_number as "blockNumber",
    block_time as "blockTime"
  FROM output
  -- series_time floor only prunes hypertable chunks; series_time >= block_time
  -- always holds, so it never drops a row the block_time bound keeps.
  WHERE series_time > NOW() - make_interval(days => $3::int)
    AND block_time = (
      SELECT MAX(block_time) FROM output
      WHERE chain_id = $1
      AND address = $2
      AND label = 'apr-oracle'
      AND series_time > NOW() - make_interval(days => $3::int)
      AND block_time > NOW() - make_interval(days => $3::int)
    )
    AND chain_id = $1
    AND address = $2
    AND label = 'apr-oracle'
  GROUP BY chain_id, address, label, block_number, block_time;
  `, [chainId, address, CURRENT_PERFORMANCE_LOOKBACK_DAYS])

  if (!result) return [0, 0]

  return [result.apr || 0, result.apy || 0, result.source || undefined]
}
