import { strict as assert } from 'node:assert'
import { beforeEach, describe, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../../db', () => ({
  default: { query }
}))

const ADDRESS = '0x1111111111111111111111111111111111111111'

// COALESCE(AVG(...), 0) reads an all-null 1-day bucket (price service outage) as 0.
// HAVING COUNT(value) > 0 is the only thing excluding those buckets — pin it.
describe('rest timeseries queries', () => {
  beforeEach(() => {
    query.mockReset()
    query.mockResolvedValue({ rows: [] })
  })

  it('getFullTimeseries excludes all-null buckets', async () => {
    const { getFullTimeseries } = await import('./db')
    await getFullTimeseries(1, ADDRESS, 'tvl')

    const sql = query.mock.calls[0][0] as string
    assert.equal(sql.includes('HAVING COUNT(value) > 0'), true)
  })

  it('getRecentTimeseries excludes all-null buckets', async () => {
    const { getRecentTimeseries } = await import('./db')
    await getRecentTimeseries(1, ADDRESS, 'tvl')

    const sql = query.mock.calls[0][0] as string
    assert.equal(sql.includes('HAVING COUNT(value) > 0'), true)
  })
})
