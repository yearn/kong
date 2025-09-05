import db from '@/app/api/db'
import { getAddress } from 'viem'

const strategyReports = async (_: object, args: { chainId?: number, address?: string }) => {
  const { chainId, address } = args
  try {
    const result = await db.query(`
    SELECT
      chain_id AS "chainId",
      address,
      event_name AS "eventName",

      args->>'profit' AS profit,
      args->>'loss' AS loss,
      args->>'debtPayment' AS "debtPayment",
      args->>'debtOutstanding' AS "debtOutstanding",
      args->>'protocolFees' AS "protocolFees",
      args->>'performanceFees' AS "performanceFees",

      hook->'apr' AS "apr",
      hook->>'profitUsd' AS "profitUsd",
      hook->>'lossUsd' AS "lossUsd",
      hook->>'debtPaymentUsd' AS "debtPaymentUsd",
      hook->>'debtOutstandingUsd' AS "debtOutstandingUsd",
      hook->>'protocolFeesUsd' AS "protocolFeesUsd",
      hook->>'performanceFeesUsd' AS "performanceFeesUsd",
      hook->>'priceUsd' AS "priceUsd",
      hook->>'priceSource' AS "priceSource",

      block_number AS "blockNumber",
      block_time AS "blockTime",
      log_index AS "logIndex",
      transaction_hash AS "transactionHash"
    FROM evmlog
    WHERE
      (chain_id = $1 OR $1 IS NULL) AND (address = $2 OR $2 IS NULL)
      AND (event_name = 'Reported' OR event_name = 'Harvested')
    ORDER BY
      block_time DESC, log_index DESC
    LIMIT 1000;`,
    [chainId, address ? getAddress(address) : null])

    return result.rows
  } catch (error) {
    console.error(error)
    throw new Error('!strategyReports')
  }
}

export default strategyReports
