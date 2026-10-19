import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('pg', () => ({
  Pool: class { query = query },
  types: { setTypeParser: vi.fn() },
}))
vi.mock('lib', () => ({ strings: {} }))
vi.mock('lib/strings', () => ({ snakeToCamelCols: vi.fn() }))

const row = { chainId: 1, address: '0x1', label: 'tvl-c', component: 'tvl', blockTime: 1n, close: 10 }

describe('sparkline cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.stubEnv('SPARKLINE_CACHE_TTL_SECONDS', '60')
    query.mockReset()
    query.mockResolvedValue({ rows: [row] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('shares sparse fallbacks and protects cached rows from mutation', async () => {
    const { getSparkline } = await import('./db')
    const results = await Promise.all(Array.from({ length: 10 }, () => getSparkline(1, '0x1', 'tvl-c', 'tvl')))
    expect(query).toHaveBeenCalledTimes(2)
    results[0][0].close = 999
    expect((await getSparkline(1, '0x1', 'tvl-c', 'tvl'))[0].close).toBe(10)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('expires entries and caches empty results too', async () => {
    query.mockResolvedValue({ rows: [] })
    const { getSparkline } = await import('./db')
    await getSparkline(1, '0x1', 'tvl-c', 'tvl')
    await getSparkline(1, '0x1', 'tvl-c', 'tvl')
    expect(query).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(60_000)
    await getSparkline(1, '0x1', 'tvl-c', 'tvl')
    expect(query).toHaveBeenCalledTimes(4)
  })

  it('invalidates all components of only the affected series', async () => {
    const { getSparkline, invalidateSparkline } = await import('./db')
    await getSparkline(1, '0x1', 'tvl-c', 'tvl')
    await getSparkline(1, '0x1', 'tvl-c')
    await getSparkline(1, '0x2', 'tvl-c', 'tvl')
    invalidateSparkline(1, '0x1', 'tvl-c')
    await getSparkline(1, '0x2', 'tvl-c', 'tvl')
    expect(query).toHaveBeenCalledTimes(6)
    await getSparkline(1, '0x1', 'tvl-c', 'tvl')
    await getSparkline(1, '0x1', 'tvl-c')
    expect(query).toHaveBeenCalledTimes(10)
  })

  it('retries failures instead of caching them', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'))
    const { getSparkline } = await import('./db')
    await expect(getSparkline(1, '0x1', 'tvl-c', 'tvl')).rejects.toThrow('database unavailable')
    await getSparkline(1, '0x1', 'tvl-c', 'tvl')
    expect(query).toHaveBeenCalledTimes(3)
  })
})
