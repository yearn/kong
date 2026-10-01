import { expect } from 'chai'
import db, { adoptLegacyStrides, getTravelledStrides } from '../db'
import { upsertEvmLog } from '.'

const CHAIN_ID = 1
const ADDRESS = '0x0eD92e4225126578791303BF579F2853e7Fdca6B' as const
const SIG_A = '0xaaaa'
const SIG_B = '0xbbbb'

async function seedLegacy() {
  await db.query(
    'INSERT INTO evmlog_strides(chain_id, address, signature, strides) VALUES ($1, $2, \'\', $3)',
    [CHAIN_ID, ADDRESS, JSON.stringify([{ from: '1', to: '50' }])])
}

async function seedThing(label: string, defaults: object) {
  await db.query(
    'INSERT INTO thing(chain_id, address, label, defaults) VALUES ($1, $2, $3, $4)',
    [CHAIN_ID, ADDRESS, label, defaults])
}

describe('load/evmlog strides', () => {
  afterEach(async () => {
    await db.query('DELETE FROM evmlog_strides WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
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

  it('adopts legacy coverage for unambiguous addresses without overwriting', async () => {
    await seedLegacy()
    await seedThing('accountant', {})
    await upsertEvmLog({ signatures: [SIG_A], chainId: CHAIN_ID, address: ADDRESS, from: 100n, to: 200n, batch: [] })

    await adoptLegacyStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, [SIG_A, SIG_B])).to.deep.equal({
      [SIG_A]: [{ from: 100n, to: 200n }],
      [SIG_B]: [{ from: 1n, to: 50n }]
    })
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
})
