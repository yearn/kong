import db from '@/app/api/db'
import { mergeSnapshotSql, pickKeysSql } from '@/lib/mergeSnapshot'
import { requestedFields } from '@/lib/requestedFields'
import { GraphQLResolveInfo } from 'graphql'

const accountStrategies = async (_: object, args: { chainId?: number, account: `0x${string}` }, _context?: unknown, info?: GraphQLResolveInfo) => {
  const { chainId, account } = args
  try {

    const rolesFilter = JSON.stringify({ roles: [{ account }] })
    const params: unknown[] = ['vault', chainId, rolesFilter, 'strategy']
    let merged = mergeSnapshotSql()
    if (info) {
      params.push(requestedFields(info))
      merged = pickKeysSql(merged, `$${params.length}`)
    }

    const result = await db.query(`
    WITH strategies AS (
      SELECT DISTINCT
        thing.chain_id,
        jsonb_array_elements_text(snapshot.hook->'strategies') AS address
      FROM thing
      JOIN snapshot
        ON thing.chain_id = snapshot.chain_id
        AND thing.address = snapshot.address
      WHERE
        thing.label = $1
        AND (thing.chain_id = $2 OR $2 IS NULL)
        AND snapshot.hook @> $3::jsonb
    )

    SELECT
      thing.chain_id,
      thing.address,
      ${merged} AS merged
    FROM thing
    JOIN strategies
      ON thing.chain_id = strategies.chain_id
      AND thing.address = strategies.address
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = $4 AND (thing.chain_id = $2 OR $2 IS NULL);`,
    params)

    return result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.merged
    }))

  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}

export default accountStrategies
