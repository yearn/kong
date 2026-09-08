import { describe, expect, it } from 'vitest'
import { allocatorSnapshotFields, allocatorSnapshotSql } from 'lib/allocator-snapshot'
import { updateSnapshotAllocator } from './allocator-store'
import type { CurrentAllocatorProjection } from './allocators'
import db from './db'

const vault = '0x1111111111111111111111111111111111111111'
const assigned = '0x2222222222222222222222222222222222222222'
const strategy = '0x3333333333333333333333333333333333333333'
const projection: CurrentAllocatorProjection = {
  schemaVersion: 1, chainId: 1337, vault, address: assigned, assignmentId: 'assignment', roleManagerAddress: vault,
  status: 'assigned', reason: null, family: 'shared', support: 'supported', asOfBlock: 20,
  deploymentSourceEventId: 'factory', revision: 'new', sourceRevision: 'fixture', blockHash: `0x${'1'.repeat(64)}`,
  observedAt: '2026-09-08T00:00:00Z', ratios: { [strategy]: { targetDebtRatio: 0, maxDebtRatio: 100 } }, evidence: { events: [], deployments: [] }
}

describe('allocator snapshot persistence', () => {
  it('activates address and ratios atomically, preserves accounting, and matches the SQL serving projection', async () => {
    const hook = { allocator: vault, debts: [{ strategy, currentDebt: '123', targetDebtRatio: 5000 }],
      composition: [{ address: strategy, targetDebtRatio: 5000 }] }
    await db.query(`INSERT INTO snapshot(chain_id,address,snapshot,hook,block_number,block_time)
      VALUES($1,$2,$3,$4,50,to_timestamp(500)) ON CONFLICT(chain_id,address) DO UPDATE SET
      snapshot=EXCLUDED.snapshot,hook=EXCLUDED.hook,block_number=50,block_time=EXCLUDED.block_time`,
    [1337, vault, { allocator: 'stale-contract-key' }, hook])
    try {
      await updateSnapshotAllocator(1337, vault, projection)
      const stored = (await db.query(`SELECT block_number,hook,${allocatorSnapshotSql} AS presented
        FROM snapshot WHERE chain_id=$1 AND address=$2`, [1337, vault])).rows[0]
      expect(Number(stored.block_number)).toBe(50)
      expect(stored.hook).toMatchObject({ allocator: assigned, debts: [{ currentDebt: '123', targetDebtRatio: 0, maxDebtRatio: 100 }] })
      expect(stored.presented).toEqual(allocatorSnapshotFields(stored.hook))
      await updateSnapshotAllocator(1337, vault, { ...projection, revision: 'old', address: vault, asOfBlock: 10, observedAt: '2026-09-07T00:00:00Z' })
      expect((await db.query('SELECT hook FROM snapshot WHERE chain_id=$1 AND address=$2', [1337, vault])).rows[0].hook.allocatorState.revision).toBe('new')
    } finally {
      await db.query('DELETE FROM snapshot WHERE chain_id=$1 AND address=$2', [1337, vault])
    }
  })
})
