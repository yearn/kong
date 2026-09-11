import type { Address } from 'viem'
import { mergeAllocatorHook } from 'lib/allocator-snapshot'
import db from 'ingest/db'
import type { CurrentAllocatorProjection } from 'ingest/abis/yearn/lib/allocators/projection'

// Refresh only the allocator fields. Concurrent accounting snapshots keep their
// own block/time, and the common merge prevents a delayed projection rollback.
export async function updateSnapshotAllocator(chainId: number, vault: Address, projection: CurrentAllocatorProjection) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT hook FROM snapshot WHERE chain_id = $1 AND address = $2 FOR UPDATE', [chainId, vault])
    if (!result.rows[0]) throw new Error('Vault snapshot missing')
    const previous = result.rows[0].hook ?? {}
    const hook = mergeAllocatorHook(previous, { allocatorState: projection })
    await client.query('UPDATE snapshot SET hook = $3 WHERE chain_id = $1 AND address = $2', [chainId, vault, hook])
    await client.query('COMMIT')
    const applied = hook.allocatorState === projection
    const staleUpdated = !applied && hook.allocatorState !== previous.allocatorState
    return { applied, projection: hook.allocatorState as CurrentAllocatorProjection, ...(staleUpdated ? { staleUpdated: true } : {}) }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
