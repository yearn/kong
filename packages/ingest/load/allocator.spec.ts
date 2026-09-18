import { afterEach, describe, expect, it } from 'vitest'
import db from '../db'
import { upsertSnapshot } from './index'
import { mergeSnapshot, mergeSnapshotSql } from '../../web/lib/mergeSnapshot'

const vault = '0xa21Cc1a4a239708690134bAeD3a1B93cAD55F625'
const controller = '0xFB4464a18d18f3FF439680BBbCE659dB2806A187'
const other = '0x1111111111111111111111111111111111111111'
const strategy = '0x2222222222222222222222222222222222222222'
const old = '0x3333333333333333333333333333333333333333'
const chainId = 100

function snapshot(blockNumber: bigint, manager = controller, allocator: string | null = old, ratio: number | null = 0) {
  return { chainId, address: vault, blockNumber, blockTime: blockNumber,
    snapshot: { apiVersion: '3.0.4', role_manager: manager, blockNumber },
    hook: { allocator, pricePerShare: String(blockNumber),
      debts: [{ strategy, currentDebt: String(blockNumber), targetDebtRatio: ratio, maxDebtRatio: ratio }],
      composition: [{ address: strategy, currentDebt: String(blockNumber), targetDebtRatio: ratio, maxDebtRatio: ratio }] } }
}
async function saved() {
  return (await db.query('SELECT * FROM snapshot WHERE chain_id = $1 AND address = $2', [chainId, vault])).rows[0]
}
async function seed() {
  const initial = snapshot(100n)
  await db.query('INSERT INTO snapshot (chain_id,address,snapshot,hook,block_number,block_time) VALUES ($1,$2,$3,$4,$5,now())',
    [chainId, vault, initial.snapshot, initial.hook, 100])
}
afterEach(async () => { await db.query('DELETE FROM snapshot WHERE chain_id = $1 AND address = $2', [chainId, vault]) })

describe('allocator snapshot persistence', () => {
  it('preserves legacy allocator and zero ratios while updating accounting', async () => {
    await seed()
    await upsertSnapshot(snapshot(200n, controller, null, null))
    const row = await saved()
    expect(row.hook.allocator).toBe(old)
    expect(row.hook.debts[0]).toMatchObject({ currentDebt: '200', targetDebtRatio: 0, maxDebtRatio: 0 })
    expect(row.hook.composition[0]).toMatchObject({ currentDebt: '200', targetDebtRatio: 0, maxDebtRatio: 0 })
    expect(row.hook.pricePerShare).toBe('200')
  })
  it('does not erase preserved ratios when a partial refresh omits retired strategies', async () => {
    await seed()
    const incoming = snapshot(200n, controller, null, null)
    incoming.hook.debts = []
    incoming.hook.composition = []
    await expect(upsertSnapshot(incoming)).rejects.toThrow('Legacy allocator strategy rows missing')
    expect(BigInt((await saved()).block_number)).toBe(100n)
    expect((await saved()).hook.debts[0]).toMatchObject({ targetDebtRatio: 0, maxDebtRatio: 0 })
  })
  it('leaves missing legacy data unavailable', async () => {
    await upsertSnapshot(snapshot(100n, controller, old, 123))
    expect((await saved()).hook).toMatchObject({ allocator: null,
      debts: [{ targetDebtRatio: null, maxDebtRatio: null }], composition: [{ targetDebtRatio: null, maxDebtRatio: null }] })
  })
  it('stops preservation after a controller change and keeps replacement ratios together', async () => {
    await seed()
    await upsertSnapshot(snapshot(200n, other, other, null))
    expect((await saved()).hook).toMatchObject({ allocator: other,
      debts: [{ targetDebtRatio: null, maxDebtRatio: null }], composition: [{ targetDebtRatio: null, maxDebtRatio: null }] })
  })
  it('does not revive an unrelated assignment when returning to a legacy controller', async () => {
    await upsertSnapshot(snapshot(100n, other, other, 555))
    await upsertSnapshot(snapshot(200n, controller, null, null))
    expect((await saved()).hook).toMatchObject({ allocator: null, debts: [{ targetDebtRatio: null, maxDebtRatio: null }] })
  })
  it('persists an explicit clear and rejects a delayed attempt to restore the assignment', async () => {
    await upsertSnapshot(snapshot(100n, other, old, 123))
    await upsertSnapshot(snapshot(300n, other, null, null))
    await upsertSnapshot(snapshot(200n, other, old, 123))
    const row = await saved()
    expect(BigInt(row.block_number)).toBe(300n)
    expect(row.hook).toMatchObject({ allocator: null, debts: [{ targetDebtRatio: null, maxDebtRatio: null }] })
  })
  it('serves the same saved fields through SQL and REST merges without allocatorState', async () => {
    await upsertSnapshot(snapshot(100n, other, other, 0))
    const row = await saved()
    const result = await db.query(`SELECT ${mergeSnapshotSql()} AS merged
      FROM snapshot CROSS JOIN (SELECT '{}'::jsonb AS defaults) thing
      WHERE chain_id = $1 AND address = $2`, [chainId, vault])
    expect(result.rows[0].merged).toEqual(mergeSnapshot({}, row.snapshot, row.hook))
    expect(result.rows[0].merged).toMatchObject({ allocator: other,
      debts: [{ targetDebtRatio: 0, maxDebtRatio: 0 }] })
    expect(result.rows[0].merged).not.toHaveProperty('allocatorState')
  })
  it('keeps the newer observation when initial writes overlap', async () => {
    await Promise.all([upsertSnapshot(snapshot(200n, other, other, 200)), upsertSnapshot(snapshot(100n, other, old, 100))])
    expect(BigInt((await saved()).block_number)).toBe(200n)
    expect((await saved()).hook.allocator).toBe(other)
  })
})
