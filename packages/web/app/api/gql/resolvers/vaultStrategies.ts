import db from '@/app/api/db'
import { getAddress } from 'viem'

const vaultStrategies = async (_: object, args: { chainId: number, vault: string }) => {
  const { chainId, vault } = args
  try {

    const result = await db.query(`
    WITH strategies AS (
      SELECT jsonb_array_elements_text(snapshot.hook->'strategies')
      FROM snapshot
      WHERE chain_id = $1 AND address = $2
    )

    SELECT
      thing.chain_id,
      thing.address,
      thing.defaults,
      snapshot.snapshot,
      snapshot.hook
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.chain_id = $1
      AND thing.address = ANY(SELECT * FROM strategies)
      AND (
        COALESCE(thing.defaults->>'erc4626', 'false')::boolean = true
        AND (
          (COALESCE(thing.defaults->>'v3', 'false')::boolean = false)
          OR (COALESCE(thing.defaults->>'v3', 'false')::boolean = true AND thing.label = 'vault')
        )
      )
    ORDER BY snapshot.hook->>'totalDebtUsd' DESC;`,
    [chainId, getAddress(vault)])

    return result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.defaults,
      ...row.snapshot,
      ...row.hook
    }))

  } catch (error) {
    console.error(error)
    throw new Error('!vaultStrategies')
  }
}

export default vaultStrategies
