import db from '@/app/api/db'
import { snakeToCamelCols } from '@/lib/strings'
import { getAddress } from 'viem'

const tvls = async (_: object, args: {
  chainId: number,
  address?: `0x${string}`,
  period?: string,
  limit?: number,
  timestamp?: bigint
}) => {
  const { chainId, address, period, limit, timestamp } = args

  try {
    const result = await db.query(`
    WITH asset_info AS (
      SELECT
        chain_id,
        address,
        defaults->>'asset' AS asset_address
      FROM thing
      WHERE chain_id = $1
        AND (address = $2 OR $2 IS NULL)
    ),
    tvl_data AS (
      SELECT
        o.chain_id,
        o.address,
        COALESCE(AVG(NULLIF(o.value, 0)), 0) AS value,
        CAST($3 AS text) AS period,
        MAX(o.block_number) AS block_number,
        time_bucket(CAST($3 AS interval), o.block_time) AS time,
        a.asset_address
      FROM output o
      JOIN asset_info a ON o.chain_id = a.chain_id AND o.address = a.address
      WHERE o.chain_id = $1
        AND (o.address = $2 OR $2 IS NULL)
        AND o.label = 'tvl'
        AND (o.block_time > to_timestamp($4) OR $4 IS NULL)
      GROUP BY o.chain_id, o.address, time, a.asset_address
      ORDER BY time ASC
      LIMIT $5
    )
    SELECT
      t.chain_id,
      t.address,
      t.value,
      t.period,
      t.block_number,
      t.time,
      CASE WHEN p.price_usd = 0 THEN NULL ELSE p.price_usd END AS price_usd,
      COALESCE(p.price_source, 'na') AS price_source
    FROM tvl_data t
    LEFT JOIN price p
      ON t.chain_id = p.chain_id
      AND t.asset_address = p.address
      AND t.block_number = p.block_number`,
    [chainId, address ? getAddress(address) : null, period ?? '1 day', timestamp, limit ?? 100])

    return snakeToCamelCols(result.rows)

  } catch (error) {
    console.error(error)
    throw new Error('!tvls')
  }
}

export default tvls
