import { strict as assert } from 'node:assert'
import { AGGREGATE_TVL_KEY, refresh } from './refresh'

const { cronDb, getAggregateVaults, getAggregateStrategies, cacheMSet } = vi.hoisted(() => ({
  cronDb: { tag: 'cron' },
  getAggregateVaults: vi.fn(),
  getAggregateStrategies: vi.fn(),
  cacheMSet: vi.fn(),
}))
let cachedValue: string

vi.mock('../../db/cron', () => ({ cronDb }))
vi.mock('./db', () => ({ getAggregateVaults, getAggregateStrategies }))
vi.mock('../cache', () => ({ cacheMSet }))

const A = '0x0000000000000000000000000000000000000001'
const B = '0x0000000000000000000000000000000000000002'

describe('aggregate TVL refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cachedValue = JSON.stringify({ value: { tvl: 999, updatedAt: 'previous-cache' } })
    cacheMSet.mockImplementation(async (pairs: Array<[string, string]>) => {
      cachedValue = pairs[0][1]
    })
    getAggregateVaults.mockResolvedValue([
      {
        chainId: 1,
        address: A,
        hook: { tvl: { close: 100 }, debts: [{ strategy: B, currentDebtUsd: 80 }] },
        mergedSnapshot: { v3: true },
      },
      {
        chainId: 1,
        address: B,
        hook: { tvl: { close: 150 } },
        mergedSnapshot: {},
      },
    ])
    getAggregateStrategies.mockResolvedValue([])
  })

  it('reads the batch inputs and publishes one complete aggregate payload to Redis', async () => {
    await refresh()

    assert.deepEqual(getAggregateVaults.mock.calls, [[cronDb]])
    assert.deepEqual(getAggregateStrategies.mock.calls, [[[], cronDb]])
    assert.equal(cacheMSet.mock.calls.length, 1)

    const pairs = cacheMSet.mock.calls[0][0] as Array<[string, string]>
    assert.equal(pairs.length, 1)
    assert.equal(pairs[0][0], AGGREGATE_TVL_KEY)
    assert.equal(cachedValue, pairs[0][1])
    const cacheEntry = JSON.parse(pairs[0][1])
    const payload = cacheEntry.value
    assert.match(payload.updatedAt, /^\d{4}-\d\d-\d\dT/)
    assert.deepEqual({ ...payload, updatedAt: 'generated-at-refresh' }, {
      tvl: 170,
      grossTvl: 250,
      deductedTvl: 80,
      updatedAt: 'generated-at-refresh',
      chains: [{ chainId: 1, tvl: 170, grossTvl: 250, deductedTvl: 80 }],
      vaults: [
        {
          chainId: 1,
          address: A,
          grossTvl: 100,
          deductedTvl: 80,
          contribution: 20,
          deductions: [{
            targetChainId: 1,
            targetAddress: B,
            amount: 80,
            reason: 'v3-debt',
          }],
        },
        {
          chainId: 1,
          address: B,
          grossTvl: 150,
          deductedTvl: 0,
          contribution: 150,
          deductions: [],
        },
      ],
    })
  })

  it('leaves the previous cached payload untouched when strategy reads fail', async () => {
    const previous = cachedValue
    getAggregateStrategies.mockRejectedValue(new Error('database unavailable'))

    await assert.rejects(refresh(), /database unavailable/)

    assert.equal(cacheMSet.mock.calls.length, 0)
    assert.equal(cachedValue, previous)
  })

  it('leaves the previous cached payload untouched when vault reads fail', async () => {
    const previous = cachedValue
    getAggregateVaults.mockRejectedValue(new Error('database unavailable'))

    await assert.rejects(refresh(), /database unavailable/)

    assert.equal(getAggregateStrategies.mock.calls.length, 0)
    assert.equal(cacheMSet.mock.calls.length, 0)
    assert.equal(cachedValue, previous)
  })

  it('leaves the previous cached payload untouched when the atomic Redis write fails', async () => {
    const previous = cachedValue
    cacheMSet.mockRejectedValue(new Error('redis unavailable'))

    await assert.rejects(refresh(), /redis unavailable/)

    assert.equal(cacheMSet.mock.calls.length, 1)
    assert.equal(cachedValue, previous)
  })
})
