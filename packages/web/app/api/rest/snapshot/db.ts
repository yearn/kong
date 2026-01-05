import db from '../../db'
import { getAddress } from 'viem'

export type VaultRow = {
  chainId: number
  address: string
}

export type VaultSnapshot = {
  chainId: number
  address: string
  [key: string]: unknown
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
 * Get vault snapshot (same query as GraphQL vault resolver)
 * Combines thing.defaults, snapshot.snapshot, and snapshot.hook
 *
 * @param chainId - Chain ID
 * @param address - Vault address
 * @returns Vault snapshot object or null if not found
 */
export async function getVaultSnapshot(
  chainId: number,
  address: string
): Promise<VaultSnapshot | null> {
  const result = await db.query(`
    SELECT
      thing.chain_id AS "chainId",
      thing.address,
      thing.defaults,
      snapshot.snapshot,
      snapshot.hook
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.chain_id = $1
      AND thing.address = $2
      AND thing.label = $3
  `, [chainId, getAddress(address as `0x${string}`), 'vault'])

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    chainId: row.chainId,
    address: row.address,
    ...row.defaults,
    ...row.snapshot,
    ...row.hook
  }
}
