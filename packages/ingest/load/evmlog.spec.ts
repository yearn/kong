import { expect } from 'chai'
import { setTimeout } from 'timers/promises'
import db, { adoptLegacyStrides, firstValue, getTravelledStrides } from '../db'
import { upsertEvmLog } from '.'

const CHAIN_ID = 1
const ADDRESS = '0x0eD92e4225126578791303BF579F2853e7Fdca6B' as const
const SIG_A = '0xaaaa'
const SIG_B = '0xbbbb'

async function seedLegacy(address: string = ADDRESS) {
  await db.query(
    'INSERT INTO evmlog_strides(chain_id, address, signature, strides) VALUES ($1, $2, \'\', $3)',
    [CHAIN_ID, address, JSON.stringify([{ from: '1', to: '50' }])])
}

async function seedThing(label: string, defaults: object) {
  await db.query(
    'INSERT INTO thing(chain_id, address, label, defaults) VALUES ($1, $2, $3, $4)',
    [CHAIN_ID, ADDRESS, label, defaults])
}

describe('load/evmlog strides', () => {
  afterEach(async () => {
    await db.query('DELETE FROM evmlog_strides WHERE chain_id = $1 AND lower(address) = lower($2)', [CHAIN_ID, ADDRESS])
    await db.query('DELETE FROM thing WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
  })

  it('credits coverage only to the signatures fetched', async () => {
    await upsertEvmLog({ signatures: [SIG_A], chainId: CHAIN_ID, address: ADDRESS, from: 100n, to: 200n, batch: [] })

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])).to.deep.equal({
      [SIG_A]: [{ from: 100n, to: 200n }]
    })
  })

  it('does not credit coverage for replays or payloads without signatures', async () => {
    await upsertEvmLog({ signatures: [SIG_A], replay: true, chainId: CHAIN_ID, address: ADDRESS, from: 1n, to: 9n, batch: [] })
    await upsertEvmLog({ abiPath: 'erc4626', chainId: CHAIN_ID, address: ADDRESS, from: 1n, to: 9n, batch: [] })

    const rows = await db.query('SELECT 1 FROM evmlog_strides WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
    expect(rows.rowCount).to.equal(0)
  })

  it('merges legacy coverage for unambiguous addresses without losing concurrent loads', async () => {
    await seedLegacy()
    await seedThing('accountant', {})
    await upsertEvmLog({ signatures: [SIG_A], chainId: CHAIN_ID, address: ADDRESS, from: 100n, to: 200n, batch: [] })

    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])).to.deep.equal({
      [SIG_A]: [{ from: 1n, to: 50n }, { from: 100n, to: 200n }],
      [SIG_B]: [{ from: 1n, to: 50n }]
    })
  })


  it('serializes adoption with a concurrent load using the same address lock', async () => {
    await seedLegacy()
    const gate = await db.connect()
    await gate.query('BEGIN')
    await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`evmlog_strides/${CHAIN_ID}/${ADDRESS}`])
    const work = Promise.all([
      adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A]),
      upsertEvmLog({ signatures: [SIG_A], chainId: CHAIN_ID, address: ADDRESS, from: 100n, to: 200n, batch: [] })
    ])
    try {
      while ((await firstValue<number>("SELECT count(*)::int FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()") ?? 0) < 2) await setTimeout(10)
    } finally {
      await gate.query('COMMIT')
      gate.release()
    }
    await work
    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A])).to.deep.equal({ [SIG_A]: [{ from: 1n, to: 50n }, { from: 100n, to: 200n }] })
  })

  it('keeps both ranges when concurrent first loads race', async () => {
    const gate = await db.connect()
    await gate.query('BEGIN; LOCK TABLE evmlog_strides IN SHARE MODE')
    const loads = Promise.all([
      upsertEvmLog({ signatures: [SIG_A], chainId: CHAIN_ID, address: ADDRESS, from: 100n, to: 200n, batch: [] }),
      upsertEvmLog({ signatures: [SIG_A], chainId: CHAIN_ID, address: ADDRESS, from: 300n, to: 400n, batch: [] })
    ])
    while ((await firstValue<number>('SELECT count(*)::int FROM pg_stat_activity WHERE wait_event_type = \'Lock\' AND datname = current_database()') ?? 0) < 2) {
      await setTimeout(10)
    }
    await gate.query('COMMIT')
    gate.release()
    await loads

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A])).to.deep.equal({
      [SIG_A]: [{ from: 100n, to: 200n }, { from: 300n, to: 400n }]
    })
  })

  it('adopts and retires a lowercase legacy row under the checksummed address', async () => {
    await seedLegacy(ADDRESS.toLowerCase())

    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A])

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A])).to.deep.equal({
      [SIG_A]: [{ from: 1n, to: 50n }]
    })
    const legacy = await db.query('SELECT 1 FROM evmlog_strides WHERE chain_id = $1 AND signature = \'\' AND lower(address) = lower($2)', [CHAIN_ID, ADDRESS])
    expect(legacy.rowCount).to.equal(0)
  })

  it('retires legacy coverage once adopted', async () => {
    await seedLegacy()
    await seedThing('accountant', {})

    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A])
    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])).to.deep.equal({
      [SIG_A]: [{ from: 1n, to: 50n }]
    })
  })

  it('does not adopt legacy coverage for erc4626 things', async () => {
    await seedLegacy()
    await seedThing('vault', { erc4626: true, yearn: true, apiVersion: '3.0.4' })

    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A])

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A])).to.deep.equal({})
  })

  it('does not adopt legacy coverage for multi-label things', async () => {
    await seedLegacy()
    await seedThing('vault', {})
    await seedThing('strategy', {})

    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A])

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A])).to.deep.equal({})
  })

  it('retires ambiguous legacy coverage even if a later fanout has only one reader', async () => {
    await seedLegacy()
    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A], true)
    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])
    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])).to.deep.equal({})
  })

  it('recognizes erc4626 things stored with different address casing', async () => {
    await seedLegacy()
    await db.query('INSERT INTO thing(chain_id, address, label, defaults) VALUES ($1, $2, $3, $4)',
      [CHAIN_ID, ADDRESS.toLowerCase(), 'vault', { erc4626: true }])
    try {
      await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A])
      expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A])).to.deep.equal({})
    } finally {
      await db.query('DELETE FROM thing WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS.toLowerCase()])
    }
  })
})
