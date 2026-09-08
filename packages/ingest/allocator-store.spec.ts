import { describe, expect, it } from 'vitest'
import { allocatorSnapshotFields, allocatorSnapshotSql } from 'lib/allocator-snapshot'
import { updateSnapshotAllocator } from './allocator-store'
import type { CurrentAllocatorProjection } from './allocators'
import db from './db'
import { upsertSnapshot } from './load'

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
  it('preserves the accepted block across snapshot failures and lagging refreshes', async () => {
    const hook = { allocatorState: projection, debts: [{ strategy, currentDebt: '123' }],
      composition: [{ address: strategy, currentDebt: '123' }] }
    await db.query(`INSERT INTO snapshot(chain_id,address,snapshot,hook,block_number,block_time)
      VALUES($1,$2,$3,$4,50,to_timestamp(500)) ON CONFLICT(chain_id,address) DO UPDATE SET
      snapshot=EXCLUDED.snapshot,hook=EXCLUDED.hook,block_number=50,block_time=EXCLUDED.block_time`,
    [1337, vault, { totalAssets: '456' }, hook])
    try {
      const unavailable: CurrentAllocatorProjection = { ...projection, address: null, revision: null,
        status: 'unavailable', support: 'unavailable', reason: 'assignment_evidence_unavailable',
        ratios: {}, asOfBlock: 0, observedAt: '2026-09-08T00:01:00Z' }
      await upsertSnapshot({ chainId: 1337, address: vault, snapshot: {}, hook: { allocatorState: unavailable },
        blockNumber: 50n, blockTime: 500n })
      const skipped = await updateSnapshotAllocator(1337, vault, { ...projection, address: vault, revision: 'older',
        asOfBlock: 10, observedAt: '2026-09-08T00:02:00Z' })
      const stored = (await db.query(`SELECT snapshot,hook,${allocatorSnapshotSql} AS presented
        FROM snapshot WHERE chain_id=$1 AND address=$2`, [1337, vault])).rows[0]
      expect(stored.snapshot).toEqual({ totalAssets: '456' })
      expect(stored.hook).toMatchObject({ allocator: null, allocatorState: { revision: null },
        debts: [{ currentDebt: '123', targetDebtRatio: null, maxDebtRatio: null }],
        composition: [{ currentDebt: '123', targetDebtRatio: null, maxDebtRatio: null }] })
      expect(stored.presented).toEqual(allocatorSnapshotFields(stored.hook))
      expect(skipped).toEqual({ applied: false, projection: stored.hook.allocatorState })

      const applied = await updateSnapshotAllocator(1337, vault, { ...projection, observedAt: '2026-09-08T00:03:00Z' })
      const recovered = (await db.query(`SELECT hook,${allocatorSnapshotSql} AS presented
        FROM snapshot WHERE chain_id=$1 AND address=$2`, [1337, vault])).rows[0]
      expect(recovered.hook).toMatchObject({ allocator: assigned,
        debts: [{ currentDebt: '123', targetDebtRatio: 0, maxDebtRatio: 100 }],
        composition: [{ currentDebt: '123', targetDebtRatio: 0, maxDebtRatio: 100 }] })
      expect(recovered.presented).toEqual(allocatorSnapshotFields(recovered.hook))
      expect(applied).toEqual({ applied: true, projection: recovered.hook.allocatorState })
    } finally {
      await db.query('DELETE FROM snapshot WHERE chain_id=$1 AND address=$2', [1337, vault])
    }
  })
  it('activates address and ratios atomically, preserves accounting, and matches the SQL serving projection', async () => {
    const hook = { allocator: vault, debts: [{ strategy, currentDebt: '123', targetDebtRatio: 5000 }],
      composition: [{ address: strategy, targetDebtRatio: 5000 }] }
    await db.query(`INSERT INTO snapshot(chain_id,address,snapshot,hook,block_number,block_time)
      VALUES($1,$2,$3,$4,50,to_timestamp(500)) ON CONFLICT(chain_id,address) DO UPDATE SET
      snapshot=EXCLUDED.snapshot,hook=EXCLUDED.hook,block_number=50,block_time=EXCLUDED.block_time`,
    [1337, vault, { allocator: 'stale-contract-key' }, hook])
    try {
      const applied = await updateSnapshotAllocator(1337, vault, projection)
      const stored = (await db.query(`SELECT block_number,hook,${allocatorSnapshotSql} AS presented
        FROM snapshot WHERE chain_id=$1 AND address=$2`, [1337, vault])).rows[0]
      expect(Number(stored.block_number)).toBe(50)
      expect(stored.hook).toMatchObject({ allocator: assigned, debts: [{ currentDebt: '123', targetDebtRatio: 0, maxDebtRatio: 100 }] })
      expect(stored.presented).toEqual(allocatorSnapshotFields(stored.hook))
      expect(applied).toEqual({ applied: true, projection: stored.hook.allocatorState })
      const skipped = await updateSnapshotAllocator(1337, vault, { ...projection, observedAt: '2026-09-07T00:00:00Z' })
      const retained = (await db.query('SELECT hook FROM snapshot WHERE chain_id=$1 AND address=$2', [1337, vault])).rows[0].hook.allocatorState
      expect(retained).toEqual(projection)
      expect(skipped).toEqual({ applied: false, projection: retained })
    } finally {
      await db.query('DELETE FROM snapshot WHERE chain_id=$1 AND address=$2', [1337, vault])
    }
  })
})
