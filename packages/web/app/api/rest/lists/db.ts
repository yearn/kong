import db from '../../db'
import { z } from 'zod'

export const VaultListItemSchema = z.object({
  chainId: z.number(),
  address: z.string(),
  name: z.string(),
})

export type VaultListItem = z.infer<typeof VaultListItemSchema>

/**
 * Get all vaults with basic info for listing
 * Uses Zod to ensure only specified fields are returned
 *
 * @returns All vaults with chainId, address, and name
 */
export async function getVaultsList(): Promise<VaultListItem[]> {
  const result = await db.query(`
    SELECT DISTINCT
      thing.chain_id AS "chainId",
      thing.address,
      COALESCE(
        thing.defaults->>'name',
        snapshot.snapshot->>'name',
        snapshot.hook->>'name'
      ) AS name
    FROM thing
    LEFT JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = 'vault'
    ORDER BY thing.chain_id, thing.address
  `)

  return z.array(VaultListItemSchema).parse(result.rows)
}
