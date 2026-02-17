import { EstimatedAprSchema } from 'lib/types'
import { z } from 'zod'
import { firstRow } from '../db'

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
  WHERE block_time = (
      SELECT MAX(block_time) FROM output
      WHERE chain_id = $1
      AND address = $2
      AND label = 'apy-bwd-delta-pps'
    )
    AND chain_id = $1
    AND address = $2
    AND label = 'apy-bwd-delta-pps'
  GROUP BY chain_id, address, label, block_number, block_time;
  `, [chainId, address])

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

export async function getLatestVaultEstimatedApr(chainId: number, address: string) {
  const result = await firstRow(`
  SELECT
    chain_id as "chainId",
    address,
    label,
    MAX(CASE WHEN component = 'netAPR' THEN value END) AS apr,
    MAX(CASE WHEN component = 'netAPY' THEN value END) AS apy,
    MAX(CASE WHEN component = 'grossAPR' THEN value END) AS "grossAPR",
    MAX(CASE WHEN component = 'baseNetAPR' THEN value END) AS "baseNetAPR",
    MAX(CASE WHEN component = 'lockerBonusAPR' THEN value END) AS "lockerBonusAPR",
    block_number as "blockNumber",
    block_time as "blockTime"
  FROM output
  WHERE block_time = (
      SELECT MAX(block_time) FROM output
      WHERE chain_id = $1
      AND LOWER(address) = LOWER($2)
      AND label NOT IN ('apr-oracle', 'apy-bwd-delta-pps', 'crv-estimated-apr', 'velo-estimated-apr', 'aero-estimated-apr')
    )
    AND chain_id = $1
    AND LOWER(address) = LOWER($2)
    AND label NOT IN ('apr-oracle', 'apy-bwd-delta-pps', 'crv-estimated-apr', 'velo-estimated-apr', 'aero-estimated-apr')
  GROUP BY chain_id, address, label, block_number, block_time;
  `, [chainId, address])

  if (!result) return undefined

  const base = result.apr != null
    ? { netAPR: result.apr || 0, grossAPR: result.grossAPR || 0 }
    : undefined

  const locker = result.baseNetAPR != null
    ? { baseNetAPR: result.baseNetAPR || 0, lockerBonusAPR: result.lockerBonusAPR || 0, grossAPR: result.grossAPR || 0 }
    : undefined

  return {
    type: result.label,
    apr: result.apr ?? ((locker?.baseNetAPR || 0) + (locker?.lockerBonusAPR || 0)),
    apy: result.apy,
    base,
    locker,
  }
}

export async function getLatestOracleApr(chainId: number, address: string): Promise<[number, number]> {
  const result = await firstRow(`
  SELECT
    chain_id as "chainId",
    address,
    label,
    MAX(CASE WHEN component = 'apr' THEN value END) AS apr,
    MAX(CASE WHEN component = 'apy' THEN value END) AS apy,
    block_number as "blockNumber",
    block_time as "blockTime"
  FROM output
  WHERE block_time = (
      SELECT MAX(block_time) FROM output
      WHERE chain_id = $1
      AND address = $2
      AND label = 'apr-oracle'
    )
    AND chain_id = $1
    AND address = $2
    AND label = 'apr-oracle'
  GROUP BY chain_id, address, label, block_number, block_time;
  `, [chainId, address])

  if (!result) return [0, 0]

  return [result.apr || 0, result.apy || 0]
}
