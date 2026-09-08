import db from '@/app/api/db'
import { allocatorSnapshotFields } from 'lib/allocator-snapshot'
import { getAddress } from 'viem'

const allocator = async (_: object, args: { chainId: number, vault: `0x${string}` }) => {
  const { chainId, vault } = args
  const result = await db.query(`
    SELECT snapshot.hook
    FROM snapshot JOIN thing ON thing.chain_id = snapshot.chain_id AND thing.address = snapshot.address
    WHERE thing.chain_id = $1 AND thing.address = $2 AND thing.label = 'vault'`, [chainId, getAddress(vault)])
  if (!result.rows[0]) return null
  const fields = allocatorSnapshotFields(result.rows[0].hook ?? {})
  return { chainId, vault: getAddress(vault), address: fields.allocator, state: fields.allocatorState }
}

export default allocator
