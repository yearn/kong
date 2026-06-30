import { expect } from 'chai'
import { types } from 'lib'
import db, { upsertThingDefaults } from './db'

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
