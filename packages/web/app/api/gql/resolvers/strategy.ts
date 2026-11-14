import db from '@/app/api/db'
import { mergeSnapshotSql, pickKeysSql } from '@/lib/mergeSnapshot'
import { requestedFields } from '@/lib/requestedFields'
import { GraphQLResolveInfo } from 'graphql'
import { getAddress } from 'viem'

const strategy = async (_: object, args: { chainId: number, address: `0x${string}` }, _context?: unknown, info?: GraphQLResolveInfo) => {
  const { chainId, address } = args
  try {
    const params: unknown[] = ['strategy', chainId, getAddress(address)]
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
    WHERE thing.label = $1 AND thing.chain_id = $2 AND thing.address = $3
    ORDER BY snapshot.hook->>'totalDebtUsd' DESC`,
    params)

    const [first] = result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.merged
    }))

    return first

  } catch (error) {
    console.error(error)
    throw new Error('!strategies')
  }
}

export default strategy
