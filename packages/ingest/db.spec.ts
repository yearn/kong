import { expect } from 'chai'
import { types } from 'lib'
import db, { getSparkline, upsertThingDefaults } from './db'

// upsertThingDefaults replaced a SELECT ... FOR UPDATE + read-modify-write
// transaction with a single INSERT ... ON CONFLICT DO UPDATE that merges
// `defaults` in-DB via jsonb `||`. This pins the old `{ ...current, ...new }`
// shallow right-wins merge semantics so the perf rewrite can't silently change
// upsert behavior. Cases below mirror real callers: registry/event/hook.ts sets
// a vault's initial defaults (yearn, origin, registry, apiVersion, ...), and
// StrategyChanged/hook.ts later upserts the same row with only a subset of keys
// (v3, erc4626, apiVersion, asset, decimals, inceptBlock, inceptTime) — the
// omitted keys (yearn, origin, registry) must survive the merge, since
// idx_thing_chain_id_address_defaults filters on defaults->>'yearn'.
describe('upsertThingDefaults', () => {
  const thing = { chainId: 1, address: '0x1', label: 'vault' }

  afterEach(async () => {
    await db.query('DELETE FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
      [thing.chainId, thing.address, thing.label])
  })

  async function getDefaults() {
    const result = await db.query('SELECT defaults FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
      [thing.chainId, thing.address, thing.label])
    return result.rows[0]?.defaults
  }

  it('inserts defaults on a new row', async () => {
    await upsertThingDefaults({ ...thing, defaults: { apiVersion: '1.0.0' } } as types.Thing)
    expect(await getDefaults()).to.deep.equal({ apiVersion: '1.0.0' })
  })

  it('shallow merges new keys into existing defaults, new value wins on overlap', async () => {
    await upsertThingDefaults({ ...thing, defaults: { apiVersion: '1.0.0', origin: 'yearn' } } as types.Thing)
    await upsertThingDefaults({ ...thing, defaults: { apiVersion: '2.0.0', inceptBlock: 100 } } as types.Thing)

    expect(await getDefaults()).to.deep.equal({ apiVersion: '2.0.0', origin: 'yearn', inceptBlock: 100 })
  })

  it('preserves keys a later upsert omits (registry hook, then StrategyChanged hook on the same vault)', async () => {
    await upsertThingDefaults({
      ...thing,
      defaults: { erc4626: true, v3: true, yearn: true, origin: 'yearn', registry: '0xregistry', apiVersion: '3.0.0' },
    } as types.Thing)

    // StrategyChanged/hook.ts never sends yearn/origin/registry.
    await upsertThingDefaults({
      ...thing,
      defaults: { v3: true, erc4626: true, apiVersion: '3.0.4', asset: '0xasset', decimals: 18, inceptBlock: 100, inceptTime: 1000 },
    } as types.Thing)

    expect(await getDefaults()).to.deep.equal({
      erc4626: true, v3: true, yearn: true, origin: 'yearn', registry: '0xregistry',
      apiVersion: '3.0.4', asset: '0xasset', decimals: 18, inceptBlock: 100, inceptTime: 1000,
    })
  })

  it('does not drop defaults.yearn when a later upsert omits it', async () => {
    await upsertThingDefaults({ ...thing, defaults: { yearn: true } } as types.Thing)
    await upsertThingDefaults({ ...thing, defaults: { inceptBlock: 100 } } as types.Thing)

    expect((await getDefaults()).yearn).to.equal(true)
  })

  it('upserting {} defaults is a no-op on existing keys', async () => {
    await upsertThingDefaults({ ...thing, defaults: { apiVersion: '1.0.0', yearn: true } } as types.Thing)
    await upsertThingDefaults({ ...thing, defaults: {} } as types.Thing)

    expect(await getDefaults()).to.deep.equal({ apiVersion: '1.0.0', yearn: true })
  })

  it('replaces a nested object wholesale instead of deep-merging it (roleManager project)', async () => {
    await upsertThingDefaults({
      ...thing,
      defaults: { roleManagerFactory: '0xfactory', project: { id: '0xproject-a' }, inceptBlock: 100 },
    } as types.Thing)

    await upsertThingDefaults({
      ...thing,
      defaults: { project: { id: '0xproject-b' } },
    } as types.Thing)

    const defaults = await getDefaults()
    // project is fully replaced, not deep-merged: no leftover keys from the old nested object.
    expect(defaults.project).to.deep.equal({ id: '0xproject-b' })
    expect(defaults.roleManagerFactory).to.equal('0xfactory')
    expect(defaults.inceptBlock).to.equal(100)
  })
})

// A 7-day bucket holding only null values (price service outage) must drop out of
// the sparkline entirely — COALESCE would otherwise close it at 0, which flows to
// snapshot.hook.tvl, gql vault.tvl, and the vault-list sort key.
describe('getSparkline', () => {
  const CHAIN_ID = 1
  const ADDRESS = '0xsparkline'
  const LABEL = 'tvl'

  // time_bucket('7 day') aligns to the timescale origin 2000-01-03T00:00Z (946857600);
  // anchor mid-bucket so rows 60s apart never straddle a boundary.
  const WEEK = 7 * 86400
  const nowish = Math.floor(Date.now() / 1000) - 30 * 86400
  const b1 = 946857600 + Math.floor((nowish - 946857600) / WEEK) * WEEK + 3600
  const b2 = b1 + WEEK
  const b3 = b2 + WEEK

  async function insert(value: number | null, blockNumber: number, time: number) {
    await db.query(`
      INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
      VALUES ($1, $2, $3, 'tvl', $4, $5, to_timestamp($6), to_timestamp($6))`,
    [CHAIN_ID, ADDRESS, LABEL, value, blockNumber, time])
  }

  afterEach(async () => {
    await db.query('DELETE FROM output WHERE chain_id = $1 AND address = $2 AND label = $3',
      [CHAIN_ID, ADDRESS, LABEL])
  })

  it('omits an all-null newest bucket instead of closing it at 0', async () => {
    await insert(10, 1, b1)
    await insert(20, 2, b2)
    await insert(null, 3, b3)
    await insert(null, 4, b3 + 60)

    const rows = await getSparkline(CHAIN_ID, ADDRESS, LABEL, 'tvl')
    expect(rows.map(row => row.close)).to.deep.equal([20, 10])
  })

  it('closes a mixed bucket on its last real value', async () => {
    await insert(20, 2, b2)
    await insert(null, 3, b2 + 60)

    const rows = await getSparkline(CHAIN_ID, ADDRESS, LABEL, 'tvl')
    expect(rows[0].close).to.equal(20)
  })

  it('closes a genuine zero at 0', async () => {
    await insert(0, 1, b2)

    const rows = await getSparkline(CHAIN_ID, ADDRESS, LABEL, 'tvl')
    expect(rows[0].close).to.equal(0)
  })
})
