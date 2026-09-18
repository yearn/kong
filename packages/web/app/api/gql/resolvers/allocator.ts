import db from '@/app/api/db'
import { getAddress } from 'viem'
import { mergeSnapshotSql } from '@/lib/mergeSnapshot'

const allocator = async (_: object, args: { chainId: number, vault: `0x${string}` }) => {
  const { chainId, vault } = args
  try {
    const address = getAddress(vault)
    const result = await db.query(`
      SELECT ${mergeSnapshotSql()} AS merged
      FROM snapshot JOIN thing ON thing.chain_id = snapshot.chain_id AND thing.address = snapshot.address
      WHERE thing.chain_id = $1 AND thing.address = $2 AND thing.label = 'vault'`, [chainId, address])
    if (!result.rows[0]) return null
    return { chainId, vault: address, address: result.rows[0].merged?.allocator ?? null }
  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}

export default allocator
