import { strict as assert } from 'node:assert'
import type { Pool } from 'pg'
import { getVaultsWithSnapshots } from './list/db'
import { getTimeseriesSince, getRecentTimeseries, getVaults as getTimeseriesVaults } from './timeseries/db'
import { getRecentStrategyReports, getStrategyReports, getVaults as getReportsVaults } from './reports/db'

const ADDRESS = '0x0000000000000000000000000000000000000001'

function mockPool(): Pool {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool
}

describe('refresh db helpers query through the given pool', () => {
  afterEach(() => vi.restoreAllMocks())

  it('getVaultsWithSnapshots', async () => {
    const pool = mockPool()
    await getVaultsWithSnapshots(pool)
    assert.equal((pool.query as ReturnType<typeof vi.fn>).mock.calls.length, 1)
  })

  it('timeseries getVaults / getTimeseriesSince / getRecentTimeseries', async () => {
    const pool = mockPool()
    await getTimeseriesVaults(pool)
    await getTimeseriesSince(1, ADDRESS, 'pps', 1_800_000_000, pool)
    await getRecentTimeseries(1, ADDRESS, 'pps', pool)
    assert.equal((pool.query as ReturnType<typeof vi.fn>).mock.calls.length, 3)
  })

  it('reports getVaults / getStrategyReports / getRecentStrategyReports', async () => {
    const pool = mockPool()
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 18, 12))
    await getReportsVaults(pool)
    await getStrategyReports(1, ADDRESS, pool)
    await getRecentStrategyReports(1, ADDRESS, pool)
    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls
    assert.equal(calls.length, 3)
    assert.match(calls[1][0], /evmlog\.block_time >= to_timestamp\(\$3\)/)
    assert.equal(calls[1][1][2], Date.UTC(2025, 10, 19) / 1000)
    assert.equal(calls[2][1][2], Date.UTC(2026, 10, 16, 12) / 1000)
  })
})
