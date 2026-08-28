import { strict as assert } from 'node:assert'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('@/app/api/db', () => ({
  default: { query }
}))

describe('tvls resolver', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('does not join price and returns null priceUsd with source na', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        chain_id: 1,
        address: '0x1111111111111111111111111111111111111111',
        value: 100,
        period: '1 day',
        block_number: 123,
        time: new Date('2024-01-01T00:00:00Z'),
        price_usd: null,
        price_source: 'na'
      }]
    })

    const { default: tvls } = await import('./tvls')
    const rows = await tvls({}, {
      chainId: 1,
      address: '0x1111111111111111111111111111111111111111'
    })

    assert.equal(query.mock.calls.length, 1)
    const sql = query.mock.calls[0][0] as string
    assert.equal(sql.includes('JOIN price'), false)
    assert.equal(sql.includes('LEFT JOIN price'), false)
    assert.equal(sql.includes('FROM price'), false)
    assert.equal(sql.includes('NULL::numeric AS price_usd'), true)
    assert.equal(sql.includes('\'na\'::text AS price_source'), true)
    assert.equal(sql.includes('asset_address'), false)

    expect(rows).toEqual([{
      chainId: 1,
      address: '0x1111111111111111111111111111111111111111',
      value: 100,
      period: '1 day',
      blockNumber: 123,
      time: new Date('2024-01-01T00:00:00Z'),
      priceUsd: null,
      priceSource: 'na'
    }])
  })

  it('preserves vault filter via thing join and ordered limit', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const { default: tvls } = await import('./tvls')
    await tvls({}, { chainId: 1, period: '1 week', limit: 10 })

    const sql = query.mock.calls[0][0] as string
    const params = query.mock.calls[0][1] as unknown[]
    assert.equal(sql.includes('t.label = \'vault\''), true)
    assert.equal(sql.includes('ORDER BY time ASC'), true)
    // all-null 1-day bucket (price service outage) must be excluded, not read as 0
    assert.equal(sql.includes('HAVING COUNT(o.value) > 0'), true)
    assert.equal(params[0], 1)
    assert.equal(params[2], '1 week')
    assert.equal(params[4], 10)
  })
})
