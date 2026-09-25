import db from '@/app/api/db'
import { getAddress } from 'viem'
import { mergedFieldSql } from '@/lib/mergeSnapshot'

const allocator = async (_: object, args: { chainId: number, vault: `0x${string}` }) => {
  const { chainId, vault } = args
  try {
    const address = getAddress(vault)
    const result = await db.query(`
      SELECT ${mergedFieldSql('allocator')} AS allocator
      FROM snapshot JOIN thing ON thing.chain_id = snapshot.chain_id AND thing.address = snapshot.address
      WHERE thing.chain_id = $1 AND thing.address = $2 AND thing.label = 'vault'`, [chainId, address])
    const assigned = result.rows[0]?.allocator
    if (assigned == null) return null
    return { chainId, vault: address, address: assigned }
  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}

export default allocator
