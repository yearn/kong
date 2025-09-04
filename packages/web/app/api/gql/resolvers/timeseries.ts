import db from '@/app/api/db'
import { snakeToCamelCols } from '@/lib/strings'
import { getAddress } from 'viem'

const timeseries = async (_: object, args: {
  chainId?: number,
  address?: `0x${string}`,
  label: string,
  component?: string,
  period?: string,
  limit?: number,
  timestamp?: bigint,
  yearn?: boolean
}) => {

  try {
    const result = await (args.yearn ? yearntimeseries : alltimeseries)(args)
    return snakeToCamelCols(result.rows)
  } catch (error) {
    console.error(error)
    throw new Error('!outputs')
  }
}

async function alltimeseries(args: {
  chainId?: number,
  address?: `0x${string}`,
  label: string,
  component?: string,
  period?: string,
  limit?: number,
  timestamp?: bigint
}) {
  const { chainId, address, label, component, period, limit, timestamp } = args
  return await db.query(`
    SELECT
      chain_id AS "chainId",
      address,
      CAST($3 AS text) AS label,
      COALESCE(CAST($4 AS text), component) AS component,
      COALESCE(AVG(NULLIF(value, 0)), 0) AS value,
      CAST($5 AS text) AS period,
      time_bucket(CAST($5 AS interval), block_time) AS time
    FROM output
    WHERE (chain_id = $1 OR $1 IS NULL)
      AND (address = $2 OR $2 IS NULL)
      AND label = $3
      AND (component = $4 OR $4 IS NULL)
      AND (block_time > to_timestamp($7) OR $7 IS NULL)
    GROUP BY chain_id, address, component, time
    ORDER BY time ASC
    LIMIT $6`,
  [chainId, address ? getAddress(address) : null, label, component, period ?? '1 day', limit ?? 100, timestamp])
}

async function yearntimeseries(args: {
  chainId?: number,
  address?: `0x${string}`,
  label: string,
  component?: string,
  period?: string,
  limit?: number,
  timestamp?: bigint
}) {
  const { chainId, address, label, component, period, limit, timestamp } = args
  return await db.query(`
    SELECT
      output.chain_id AS "chainId",
      output.address,
      CAST($3 AS text) AS label,
      COALESCE(CAST($4 AS text), output.component) AS component,
      COALESCE(AVG(NULLIF(output.value, 0)), 0) AS value,
      CAST($5 AS text) AS period,
      time_bucket(CAST($5 AS interval), output.block_time) AS time
    FROM output
    JOIN thing ON
      output.chain_id = thing.chain_id
      AND output.address = thing.address
      AND thing.defaults->>'yearn' = 'true'
    WHERE (output.chain_id = $1 OR $1 IS NULL)
      AND (output.address = $2 OR $2 IS NULL)
      AND output.label = $3
      AND (output.component = $4 OR $4 IS NULL)
      AND (output.block_time > to_timestamp($7) OR $7 IS NULL)
    GROUP BY output.chain_id, output.address, output.component, time
    ORDER BY time ASC
    LIMIT $6`,
  [chainId, address, label, component, period ?? '1 day', limit ?? 100, timestamp])
}

export default timeseries
