import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ query: vi.fn(), writes: vi.fn(), release: vi.fn() }))
vi.mock('pg', () => ({
  Pool: class { query = state.query; connect = async () => ({ query: state.writes, release: state.release }) },
  types: { setTypeParser: vi.fn() },
}))
vi.mock('lib', () => ({
  strings: { camelToSnake: (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`) },
  strider: {}, sentry: {}, mq: { job: { load: Object.fromEntries(['block', 'monitor', 'evmlog', 'snapshot', 'thing', 'output'].map(name => [name, { name }])) } },
}))
vi.mock('lib/strings', () => ({ snakeToCamelCols: vi.fn() }))
const address = '0x1111111111111111111111111111111111111111'
const row = { chainId: 1, address, label: 'tvl-c', component: 'tvl', blockTime: 1n, close: 10 }

const NOW = new Date('2026-10-21T12:00:00Z')
const CURRENT_WEEK = BigInt(Date.parse('2026-10-19T00:00:00Z') / 1000)
const output = (blockTime: bigint) => ({ chainId: 1, address, label: 'tvl-c', component: 'tvl', value: 10, blockNumber: 2n, blockTime })

describe('sparkline write lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.stubEnv('SPARKLINE_CACHE_TTL_SECONDS', '3600')
    state.query.mockReset().mockImplementation(async (sql: string) => ({ rows: sql.includes('AND block_time >=') ? [] : [row] }))
    state.writes.mockReset().mockResolvedValue({ rows: [] })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

  it('reuses sparse history across ingestion cycles while reading fresh current-week values', async () => {
    const { getSparkline } = await import('./db')
    const { upsertBatchOutput } = await import('./load')
    let close = 20
    state.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('AND block_time >=')
      ? [{ ...row, blockTime: CURRENT_WEEK, close }]
      : [row] }))
    for (let cycle = 0; cycle < 4; cycle++) {
      const rows = await getSparkline(1, address, 'tvl-c', 'tvl')
      expect(rows.map(row => row.close)).toEqual([close, 10])
      await upsertBatchOutput([output(BigInt(Date.now() / 1000))])
      close++
      vi.advanceTimersByTime(15 * 60 * 1000)
    }
    expect(state.query).toHaveBeenCalledTimes(6)
    expect(state.query.mock.calls.filter(([sql]) => !sql.includes('AND series_time >=')).length).toBe(1)
  })

  it('does not invalidate the cached series when an output write rolls back', async () => {
    const { getSparkline } = await import('./db')
    const { upsertBatchOutput } = await import('./load')
    await getSparkline(1, address, 'tvl-c', 'tvl')
    state.writes.mockRejectedValueOnce(new Error('failed write'))
    await expect(upsertBatchOutput([{ chainId: 1, address, label: 'tvl-c', component: 'tvl', value: 20, blockNumber: 2n, blockTime: 1n }])).rejects.toThrow()
    await getSparkline(1, address, 'tvl-c', 'tvl')
    expect(state.query).toHaveBeenCalledTimes(4)
  })

  it('keeps a fresh cache entry when an invalidated older in-flight query completes later', async () => {
    const { getSparkline, invalidateSparkline } = await import('./db')
    let resolveOld!: (value: { rows: typeof row[] }) => void
    state.query.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const oldPending = getSparkline(1, address, 'tvl-c', 'tvl')
    invalidateSparkline(1, address, 'tvl-c')
    state.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('AND block_time >=')
      ? [] : Array.from({ length: 3 }, () => ({ ...row, close: 20 })) }))
    expect((await getSparkline(1, address, 'tvl-c', 'tvl'))[0].close).toBe(20)
    resolveOld({ rows: Array.from({ length: 3 }, () => row) })
    await oldPending
    expect((await getSparkline(1, address, 'tvl-c', 'tvl'))[0].close).toBe(20)
  })

  it('disables caching with TTL=0', async () => {
    vi.stubEnv('SPARKLINE_CACHE_TTL_SECONDS', '0')
    const { getSparkline } = await import('./db')
    await getSparkline(1, address, 'tvl-c', 'tvl')
    await getSparkline(1, address, 'tvl-c', 'tvl')
    expect(state.query).toHaveBeenCalledTimes(4)
  })

  it('evicts the oldest series when the 10,000 series capacity is reached', async () => {
    const { getSparkline } = await import('./db')
    state.query.mockResolvedValue({ rows: [] })
    for (let i = 0; i < 10_001; i++) await getSparkline(1, `0x${i}`, 'tvl-c', 'tvl')
    expect(state.query).toHaveBeenCalledTimes(30_003)
    await getSparkline(1, '0x10000', 'tvl-c', 'tvl')
    expect(state.query).toHaveBeenCalledTimes(30_004)
    await getSparkline(1, '0x0', 'tvl-c', 'tvl')
    expect(state.query).toHaveBeenCalledTimes(30_007)
  })

  it('invalidates historical buckets after a committed older backfill', async () => {
    const { getSparkline } = await import('./db')
    const { upsertBatchOutput } = await import('./load')
    await getSparkline(1, address, 'tvl-c', 'tvl')
    await upsertBatchOutput([output(CURRENT_WEEK - 1n)])
    state.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('AND block_time >=') ? [] : [{ ...row, close: 30 }] }))
    expect((await getSparkline(1, address, 'tvl-c', 'tvl'))[0].close).toBe(30)
    expect(state.query).toHaveBeenCalledTimes(6)
  })

  it('observes current-week writes and null corrections from other processes without invalidation', async () => {
    const { getSparkline } = await import('./db')
    await getSparkline(1, address, 'tvl-c', 'tvl')
    let current = [{ ...row, blockTime: CURRENT_WEEK, close: 20 }]
    state.query.mockImplementation(async () => ({ rows: current }))
    expect((await getSparkline(1, address, 'tvl-c', 'tvl')).map(row => row.close)).toEqual([20, 10])
    current = [] // SQL omits an all-null bucket.
    expect((await getSparkline(1, address, 'tvl-c', 'tvl')).map(row => row.close)).toEqual([10])
    expect(state.query).toHaveBeenCalledTimes(5)
  })

  it('repartitions history when the UTC week changes before the TTL expires', async () => {
    vi.setSystemTime(new Date('2026-10-25T23:59:00Z'))
    const { getSparkline } = await import('./db')
    state.query.mockResolvedValue({ rows: [] })
    await getSparkline(1, address, 'tvl-c', 'tvl')
    vi.advanceTimersByTime(120_000)
    await getSparkline(1, address, 'tvl-c', 'tvl')
    expect(state.query).toHaveBeenCalledTimes(6)
    expect(state.query.mock.calls[0][1][4]).toBe(Number(CURRENT_WEEK))
    expect(state.query.mock.calls[3][1][4]).toBe(Number(CURRENT_WEEK) + 7 * 86400)
  })
})
