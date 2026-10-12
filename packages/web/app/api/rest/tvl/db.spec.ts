import { strict as assert } from 'node:assert'
import { getAddress } from 'viem'
import { getAggregateStrategies, getAggregateVaults } from './db'

const query = vi.fn()
const pool = { query }

const A = '0x0000000000000000000000000000000000000001'
const B = '0x0000000000000000000000000000000000000002'
const STRATEGY = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

describe('aggregate TVL database reads', () => {
  beforeEach(() => {
    query.mockReset()
    query.mockResolvedValue({ rows: [] })
  })

  it('selects distinct chain/address vaults with the existing Yearn filter and merged snapshot fields', async () => {
    query.mockResolvedValue({
      rows: [{
        chainId: '1',
        address: A,
        _defaults: { v3: true, origin: 'yearn' },
        _snapshot: { v3: true, pricePerShare: '42' },
        _hook: {
          asset: { address: B, symbol: 'yvTOKEN' },
          tvl: { close: 100 },
          debts: [{ strategy: STRATEGY, currentDebtUsd: 25 }],
        },
      }],
    })

    const vaults = await getAggregateVaults(pool as never)

    const sql = query.mock.calls[0][0] as string
    assert.doesNotMatch(sql, /DISTINCT|lower\(/)
    assert.match(sql, /thing\.label = \$1/)
    assert.match(sql, /OR/)
    assert.match(sql, /origin.*yearn/)
    assert.match(sql, /LEFT JOIN snapshot/)
    assert.match(sql, /thing\.address = snapshot\.address/)
    assert.deepEqual(query.mock.calls[0][1], ['vault'])
    assert.equal(vaults.length, 1)
    assert.equal(vaults[0].chainId, 1)
    assert.deepEqual(vaults[0].hook, {
      asset: { address: B, symbol: 'yvTOKEN' },
      tvl: { close: 100 },
      debts: [{ strategy: STRATEGY, currentDebtUsd: 25 }],
    })
    assert.deepEqual(vaults[0].mergedSnapshot.asset, { address: B, symbol: 'yvTOKEN' })
    assert.deepEqual(vaults[0].mergedSnapshot.debts, [{ strategy: STRATEGY, currentDebtUsd: 25 }])
    assert.equal(vaults[0].mergedSnapshot.v3, true)
  })

  it('batch-reads only unique, valid chain-scoped strategy refs', async () => {
    const refs = [
      { chainId: 1, address: STRATEGY.toUpperCase() },
      { chainId: 1, address: STRATEGY },
      { chainId: 10, address: STRATEGY },
      { chainId: 0, address: B },
      { chainId: 1, address: '  ' },
    ]
    query.mockResolvedValue({
      rows: [{
        chainId: 10,
        address: STRATEGY,
        hook: { aggregateTvlExposures: [{ attributableUsd: 20 }] },
      }],
    })

    const strategies = await getAggregateStrategies(refs, pool as never)

    const sql = query.mock.calls[0][0] as string
    assert.match(sql, /unnest\(\$1::int\[\], \$2::text\[\]\)/)
    assert.match(sql, /thing\.label = 'strategy'/)
    assert.match(sql, /requested\.chain_id = thing\.chain_id/)
    assert.match(sql, /requested\.address = thing\.address/)
    assert.match(sql, /INNER JOIN snapshot/)
    assert.doesNotMatch(sql, /lower\(|_defaults|_snapshot/)
    assert.match(sql, /thing\.address = snapshot\.address/)
    assert.deepEqual(query.mock.calls[0][1], [
      [1, 10],
      [getAddress(STRATEGY), getAddress(STRATEGY)],
    ])
    assert.equal(strategies.length, 1)
    assert.deepEqual(strategies[0].hook, { aggregateTvlExposures: [{ attributableUsd: 20 }] })
    assert.equal(strategies[0].chainId, 10)
  })

  it('skips the strategy query when no valid refs are requested', async () => {
    const strategies = await getAggregateStrategies([
      { chainId: -1, address: STRATEGY },
      { chainId: 1, address: '' },
    ], pool as never)

    assert.deepEqual(strategies, [])
    assert.equal(query.mock.calls.length, 0)
  })
})
