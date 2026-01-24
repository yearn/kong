import db from '@/app/api/db'
import { getAddress } from 'viem'

export type VaultRow = {
  chainId: number
  address: string
}

export interface ReportApr {
  gross?: number
  net?: number
}

export interface VaultReport {
  chainId: number
  address: string
  eventName: string

  // Strategy report args (BigInt fields)
  strategy: string
  gain: bigint
  loss: bigint
  debtPaid?: bigint
  totalGain?: bigint
  totalLoss?: bigint
  totalDebt?: bigint
  debtAdded?: bigint
  debtRatio?: bigint
  currentDebt?: bigint
  protocolFees?: bigint
  totalFees?: bigint
  totalRefunds?: bigint

  // USD values from hook (Float fields)
  gainUsd?: number
  lossUsd?: number
  debtPaidUsd?: number
  totalGainUsd?: number
  totalLossUsd?: number
  totalDebtUsd?: number
  debtAddedUsd?: number
  currentDebtUsd?: number
  protocolFeesUsd?: number
  totalFeesUsd?: number
  totalRefundsUsd?: number
  apr?: ReportApr

  // Block metadata
  blockNumber: number
  blockTime: bigint
  logIndex: number
  transactionHash: string
}

/**
 * Get all vaults
 * Used by refresh workflow to iterate over all vaults
 *
 * @returns All vaults with chainId and address
 */
export async function getVaults(): Promise<VaultRow[]> {
  const result = await db.query(`
    SELECT DISTINCT
      chain_id AS "chainId",
      address
    FROM thing
    WHERE label = 'vault'
    ORDER BY chain_id, address
  `)

  return result.rows as VaultRow[]
}

/**
 * Get strategy reports for a vault
 * Used by both API endpoint and refresh script
 *
 * @param chainId - Chain ID (optional for refresh, required for API)
 * @param address - Vault address (optional for refresh, required for API)
 * @returns Array of vault reports
 */
export const getStrategyReports = async (chainId?: number, address?: string) => {
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

    return result.rows as VaultReport[]
  } catch (error) {
    console.error(error)
    throw new Error('!getStrategyReports')
  }
}
