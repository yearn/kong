import { strict as assert } from 'node:assert'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../../db', () => ({
  default: { query }
}))

const ADDRESS = '0x1111111111111111111111111111111111111111'

// COALESCE(AVG(...), 0) reads an all-null 1-day bucket (price service outage) as 0.
// HAVING COUNT(value) > 0 is the only thing excluding those buckets — pin it.
describe('rest timeseries queries', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 18))
    query.mockReset()
    query.mockResolvedValue({ rows: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('getTimeseriesSince excludes all-null buckets', async () => {
    const { getTimeseriesSince } = await import('./db')
    await getTimeseriesSince(1, ADDRESS, 'tvl', 0)

    const sql = query.mock.calls[0][0] as string
    assert.ok(sql.includes('series_time >= to_timestamp($4'))
    assert.equal(query.mock.calls[0][1][3], Date.UTC(2025, 10, 19) / 1000)
    assert.equal(sql.includes('HAVING COUNT(value) > 0'), true)
  })

  it('getRecentTimeseries excludes all-null buckets', async () => {
    const { getRecentTimeseries } = await import('./db')
    await getRecentTimeseries(1, ADDRESS, 'tvl')

    const sql = query.mock.calls[0][0] as string
    assert.equal(query.mock.calls[0][1][3], Date.UTC(2026, 10, 16) / 1000)
    assert.equal(sql.includes('HAVING COUNT(value) > 0'), true)
  })
})
