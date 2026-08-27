import db from '@/app/api/db'
import { snakeToCamelCols } from '@/lib/strings'
import { getAddress } from 'viem'
import { clampLimit, resolvePeriod } from './guards'

const tvls = async (_: object, args: {
  chainId: number,
  address?: `0x${string}`,
  period?: string,
  limit?: number,
  timestamp?: bigint
}) => {
  const { chainId, address, timestamp } = args

  // Bound caller-controlled aggregation cost before issuing the chain-wide query.
  const period = resolvePeriod(args.period)
  const limit = clampLimit(args.limit)

  try {
    // price join removed: table-backed per-block prices were unusable spot snapshots.
    // priceUsd/priceSource kept null/'na' for response shape compatibility.
    const result = await db.query(`
    SELECT
      o.chain_id,
      o.address,
      COALESCE(AVG(NULLIF(o.value, 0)), 0) AS value,
      CAST($3 AS text) AS period,
      MAX(o.block_number) AS block_number,
      time_bucket(CAST($3 AS interval), o.block_time) AS time,
      NULL::numeric AS price_usd,
      'na'::text AS price_source
    FROM output o
    JOIN thing t ON o.chain_id = t.chain_id AND o.address = t.address
    WHERE o.chain_id = $1
      AND (o.address = $2 OR $2 IS NULL)
      AND t.label = 'vault'
      AND o.label = 'tvl-c'
      AND o.component = 'tvl'
      AND (o.block_time > to_timestamp($4) OR $4 IS NULL)
    GROUP BY o.chain_id, o.address, time
    HAVING COUNT(o.value) > 0
    ORDER BY time ASC
    LIMIT $5`,
    [chainId, address ? getAddress(address) : null, period, timestamp, limit])

    return snakeToCamelCols(result.rows)

  } catch (error) {
    console.error(error)
    throw new Error('!tvls')
  }
}

export default tvls
