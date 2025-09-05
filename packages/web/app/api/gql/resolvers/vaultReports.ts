import db from '@/app/api/db'
import { getAddress } from 'viem'

const vaultReports = async (_: object, args: { chainId?: number, address?: string }) => {
  const { chainId, address } = args
  try {
    const result = await db.query(`
    SELECT
      chain_id AS "chainId",
      address,
      event_name AS "eventName",

      args->>'strategy' AS strategy,
      args->>'gain' AS gain,
      args->>'loss' AS loss,
      args->>'debtPaid' AS "debtPaid",
      args->>'totalGain' AS "totalGain",
      args->>'totalLoss' AS "totalLoss",
      args->>'totalDebt' AS "totalDebt",
      args->>'debtAdded' AS "debtAdded",
      args->>'debtRatio' AS "debtRatio",
      args->>'current_debt' AS "currentDebt",
      args->>'protocol_fees' AS "protocolFees",
      args->>'total_fees' AS "totalFees",
      args->>'total_refunds' AS "totalRefunds",

      hook->>'gainUsd' AS "gainUsd",
      hook->>'lossUsd' AS "lossUsd",
      hook->>'debtPaidUsd' AS "debtPaidUsd",
      hook->>'totalGainUsd' AS "totalGainUsd",
      hook->>'totalLossUsd' AS "totalLossUsd",
      hook->>'totalDebtUsd' AS "totalDebtUsd",
      hook->>'debtAddedUsd' AS "debtAddedUsd",
      hook->>'currentDebtUsd' AS "currentDebtUsd",
      hook->>'protocolFeesUsd' AS "protocolFeesUsd",
      hook->>'totalFeesUsd' AS "totalFeesUsd",
      hook->>'totalRefundsUsd' AS "totalRefundsUsd",
      hook->'apr' AS "apr",

      block_number AS "blockNumber",
      block_time AS "blockTime",
      log_index AS "logIndex",
      transaction_hash AS "transactionHash"
    FROM evmlog
    WHERE
      (chain_id = $1 OR $1 IS NULL) AND (address = $2 OR $2 IS NULL)
      AND event_name = 'StrategyReported'
    ORDER BY
      block_time DESC, log_index DESC
    LIMIT 1000;`,
    [chainId, address ? getAddress(address) : null])

    return result.rows
  } catch (error) {
    console.error(error)
    throw new Error('!vaultReports')
  }
}

export default vaultReports
