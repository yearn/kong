import db from '@/app/api/db'
import { compare } from '@/lib/compare'
import { mergeSnapshotSql, pickKeysSql, SnapshotRow } from '@/lib/mergeSnapshot'
import { requestedFields } from '@/lib/requestedFields'
import { GraphQLResolveInfo } from 'graphql'

const strategies = async (_: object, args: { chainId?: number, apiVersion?: string, erc4626?: boolean }, _context?: unknown, info?: GraphQLResolveInfo) => {
  const { chainId, apiVersion, erc4626 } = args
  try {
    const params: unknown[] = ['strategy', chainId]
    let merged = mergeSnapshotSql()
    if (info) {
      params.push([...requestedFields(info), 'apiVersion', 'erc4626'])
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
    WHERE thing.label = $1 AND (thing.chain_id = $2 OR $2 IS NULL)
    ORDER BY snapshot.hook->>'totalDebtUsd' DESC`,
    params)

    let rows: SnapshotRow[] = result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.merged
    }))

    if (apiVersion) {
      rows = rows.filter(row => {
        const rowApiVersion = row.apiVersion
        return typeof rowApiVersion !== 'string' || !rowApiVersion || compare(rowApiVersion, apiVersion, '>=')
      })
    }

    if (erc4626 !== undefined) {
      rows = rows.filter(row => {
        return Boolean(row.erc4626 ?? false) === erc4626
      })
    }

    return rows

  } catch (error) {
    console.error(error)
    throw new Error('!strategies')
  }
}

export default strategies
