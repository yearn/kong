import db from '@/app/api/db'
import { compare } from '@/lib/compare'
import { mergeSnapshot, SnapshotRow } from '@/lib/mergeSnapshot'

const strategies = async (_: object, args: { chainId?: number, apiVersion?: string, erc4626?: boolean }) => {
  const { chainId, apiVersion, erc4626 } = args
  try {

    const result = await db.query(`
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
    WHERE thing.label = $1 AND (thing.chain_id = $2 OR $2 IS NULL)
    ORDER BY snapshot.hook->>'totalDebtUsd' DESC`,
    ['strategy', chainId])

    let rows: SnapshotRow[] = result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...mergeSnapshot(row.defaults, row.snapshot, row.hook)
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
