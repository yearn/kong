import { strict as assert } from 'node:assert'
import { beforeEach, describe, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('@/app/api/db', () => ({
  default: { query }
}))

// COALESCE(AVG(...), 0) reads an all-null bucket (price service outage) as 0.
// HAVING COUNT(value) > 0 is the only thing excluding those buckets — pin it.
describe('timeseries resolver', () => {
  beforeEach(() => {
    query.mockReset()
    query.mockResolvedValue({ rows: [] })
  })

  it('alltimeseries excludes all-null buckets', async () => {
    const { default: timeseries } = await import('./timeseries')
    await timeseries({}, { label: 'tvl' })

    const sql = query.mock.calls[0][0] as string
    assert.equal(sql.includes('HAVING COUNT(value) > 0'), true)
  })

  it('yearntimeseries excludes all-null buckets', async () => {
    const { default: timeseries } = await import('./timeseries')
    await timeseries({}, { label: 'tvl', yearn: true })

    const sql = query.mock.calls[0][0] as string
    assert.equal(sql.includes('HAVING COUNT(output.value) > 0'), true)
  })
})
