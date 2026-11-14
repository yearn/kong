import db from '@/app/api/db'
import { mergeSnapshotSql, pickKeysSql, VAULT_UNSERVED_KEYS } from '@/lib/mergeSnapshot'
import { requestedFields } from '@/lib/requestedFields'
import { GraphQLResolveInfo } from 'graphql'

const accountVaults = async (_: object, args: { chainId?: number, account: `0x${string}` }, _context?: unknown, info?: GraphQLResolveInfo) => {
  const { chainId, account } = args
  try {

    const rolesFilter = JSON.stringify({ roles: [{ account }] })
    const params: unknown[] = ['vault', chainId, rolesFilter]
    let merged = mergeSnapshotSql(VAULT_UNSERVED_KEYS)
    if (info) {
      params.push(requestedFields(info))
      merged = pickKeysSql(merged, `$${params.length}`)
    }

    const result = await db.query(`
    SELECT
      thing.chain_id,
      thing.address,
      ${merged} AS merged
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE
      thing.label = $1
      AND (thing.chain_id = $2 OR $2 IS NULL)
      AND snapshot.hook @> $3::jsonb
    ORDER BY snapshot.hook->>'tvl' DESC`,
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

export default accountVaults
