import db from '@/app/api/db'
import { compare } from '@/lib/compare'

const vaults = async (_: any, args: { 
  chainId?: number, 
  apiVersion?: string, 
  erc4626?: boolean,
  v3?: boolean,
  yearn?: boolean
}) => {
  const { chainId, apiVersion, erc4626, v3, yearn } = args
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
    ORDER BY (snapshot.hook->'tvl'->>'close')::numeric DESC`,
    ['vault', chainId])

    let rows = result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.defaults,
      ...row.snapshot,
      ...row.hook
    }))

    if (apiVersion !== undefined) {
      rows = rows.filter(row => {
        return compare(row.apiVersion ?? '0', apiVersion, '>=')
      })
    }

    if (erc4626 !== undefined) {
      rows = rows.filter(row => {
        return Boolean(row.erc4626 ?? false) === erc4626
      })
    }

    if (v3 !== undefined) {
      rows = rows.filter(row => {
        return Boolean(row.v3 ?? false) === v3
      })
    }

    if (yearn !== undefined) {
      rows = rows.filter(row => {
        return Boolean(row.yearn ?? false) === yearn
      })
    }

    return rows

  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}

export default vaults
