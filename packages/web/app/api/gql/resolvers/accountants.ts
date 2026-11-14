import db from '@/app/api/db'
import { mergeSnapshotSql, pickKeysSql } from '@/lib/mergeSnapshot'
import { requestedFields } from '@/lib/requestedFields'
import { GraphQLResolveInfo } from 'graphql'

const accountants = async (_: object, args: { chainId?: number }, _context?: unknown, info?: GraphQLResolveInfo) => {
  const { chainId } = args
  try {
    const params: unknown[] = ['accountant', chainId]
    let merged = mergeSnapshotSql()
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
    WHERE thing.label = $1 AND (thing.chain_id = $2 OR $2 IS NULL)`,
    params)

    return result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.merged
    }))

  } catch (error) {
    console.error(error)
    throw new Error('!accountants')
  }
}

export default accountants
