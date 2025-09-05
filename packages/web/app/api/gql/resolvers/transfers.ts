import db from '@/app/api/db'
import { getAddress } from 'viem'

const transfers = async (_: object, args: { chainId: number, address: string }) => {
  const { chainId, address } = args
  try {
    const result = await db.query(`
    SELECT
      chain_id AS "chainId",
      address,
      args->>'sender' as sender,
      args->>'receiver' as receiver,
      args->>'value' AS value,
      hook->>'valueUsd' AS "valueUsd",
      block_number AS "blockNumber",
      block_time AS "blockTime",
      log_index AS "logIndex",
      transaction_hash AS "transactionHash"
    FROM
      evmlog
    WHERE
      (chain_id = $1 OR $1 IS NULL) AND (address = $2 OR $2 IS NULL)
      AND event_name = 'Transfer'
      AND args->>'sender' IS NOT NULL
      AND args->>'receiver' IS NOT NULL
    ORDER BY
      chain_id, block_time DESC, log_index DESC
    LIMIT 100;`,
    [chainId, address ? getAddress(address) : null])

    return result.rows
  } catch (error) {
    console.error(error)
    throw new Error('!transfers')
  }
}

export default transfers
