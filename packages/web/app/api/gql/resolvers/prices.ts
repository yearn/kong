import db from '@/app/api/db'
import { getAddress } from 'viem'

// Backstop cap so a single-token history can never return the whole table.
// ponytail: a fixed ceiling, not cursor pagination — selective filters keep real
// queries far under it; raise + add a cursor if a token legitimately exceeds it.
const MAX_PRICE_ROWS = 50000

const prices = async (_: object, args: { chainId?: number, address?: `0x${string}`, timestamp?: bigint }) => {
  const { chainId, address, timestamp } = args

  // Require a selective partition so an anonymous caller cannot scan the 124M-row
  // price table with no filters (FINDINGS.md finding 1, CWE-400).
  if (!address && timestamp == null) {
    throw new Error('prices requires address or timestamp')
  }

  try {

    const result = await db.query(`
    SELECT
      chain_id as "chainId",
      address,
      price_usd as "priceUsd",
      price_source as "priceSource",
      block_number as "blockNumber",
      block_time as timestamp
    FROM price
    WHERE (chain_id = $1 OR $1 IS NULL)
      AND (address = $2 OR $2 IS NULL)
      AND (block_time > to_timestamp($3) OR $3 IS NULL)
    ORDER BY block_time ASC
    LIMIT ${MAX_PRICE_ROWS}`,
    [chainId, address ? getAddress(address) : null, timestamp])

    return result.rows

  } catch (error) {
    console.error(error)
    throw new Error('!prices')
  }
}

export default prices
