import type { Address } from 'viem'
import { mergeAllocatorHook } from 'lib/allocator-snapshot'
import db from './db'
import type { CurrentAllocatorProjection } from './allocators'

// Refresh only the allocator fields. Concurrent accounting snapshots keep their
// own block/time, and the common merge prevents a delayed projection rollback.
export async function updateSnapshotAllocator(chainId: number, vault: Address, projection: CurrentAllocatorProjection) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT hook FROM snapshot WHERE chain_id = $1 AND address = $2 FOR UPDATE', [chainId, vault])
    if (!result.rows[0]) throw new Error('Vault snapshot missing')
    const hook = mergeAllocatorHook(result.rows[0].hook ?? {}, { allocatorState: projection })
    await client.query('UPDATE snapshot SET hook = $3 WHERE chain_id = $1 AND address = $2', [chainId, vault, hook])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
