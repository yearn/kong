import { strict as assert } from 'node:assert'
import type { Pool } from 'pg'
import { getVaultsWithSnapshots } from './list/db'
import { getFullTimeseries, getRecentTimeseries, getVaults as getTimeseriesVaults } from './timeseries/db'
import { getRecentStrategyReports, getStrategyReports, getVaults as getReportsVaults } from './reports/db'

const ADDRESS = '0x0000000000000000000000000000000000000001'

function mockPool(): Pool {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool
}

describe('refresh db helpers query through the given pool', () => {
  it('getVaultsWithSnapshots', async () => {
    const pool = mockPool()
    await getVaultsWithSnapshots(pool)
    assert.equal((pool.query as ReturnType<typeof vi.fn>).mock.calls.length, 1)
  })

  it('timeseries getVaults / getFullTimeseries / getRecentTimeseries', async () => {
    const pool = mockPool()
    await getTimeseriesVaults(pool)
    await getFullTimeseries(1, ADDRESS, 'pps', pool)
    await getRecentTimeseries(1, ADDRESS, 'pps', pool)
    assert.equal((pool.query as ReturnType<typeof vi.fn>).mock.calls.length, 3)
  })

  it('reports getVaults / getStrategyReports / getRecentStrategyReports', async () => {
    const pool = mockPool()
    await getReportsVaults(pool)
    await getStrategyReports(1, ADDRESS, pool)
    await getRecentStrategyReports(1, ADDRESS, pool)
    assert.equal((pool.query as ReturnType<typeof vi.fn>).mock.calls.length, 3)
  })
})
