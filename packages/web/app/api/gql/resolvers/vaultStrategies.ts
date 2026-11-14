import db from '@/app/api/db'
import { mergeSnapshotSql, pickKeysSql } from '@/lib/mergeSnapshot'
import { requestedFields } from '@/lib/requestedFields'
import { GraphQLResolveInfo } from 'graphql'
import { getAddress } from 'viem'

const vaultStrategies = async (_: object, args: { chainId: number, vault: string }, _context?: unknown, info?: GraphQLResolveInfo) => {
  const { chainId, vault } = args
  try {
    const params: unknown[] = [chainId, getAddress(vault)]
    let merged = mergeSnapshotSql()
    if (info) {
      params.push(requestedFields(info))
      merged = pickKeysSql(merged, `$${params.length}`)
    }

    const result = await db.query(`
    WITH strategies AS (
      SELECT jsonb_array_elements_text(snapshot.hook->'strategies')
      FROM snapshot
      WHERE chain_id = $1 AND address = $2
    )

    SELECT
      thing.chain_id,
      thing.address,
      ${merged} AS merged
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
    params)

    return result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.merged
    }))

  } catch (error) {
    console.error(error)
    throw new Error('!vaultStrategies')
  }
}

export default vaultStrategies
