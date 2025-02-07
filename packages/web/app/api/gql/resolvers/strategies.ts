import db from '@/app/api/db'
import { compare } from '@/lib/compare'

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

    let rows = result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.defaults,
      ...row.snapshot,
      ...row.hook
    }))

    if (apiVersion) {
      rows = rows.filter(row => {
        return !row.apiVersion || compare(row.apiVersion, apiVersion, '>=')
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
