import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { store, cacheTtls, cacheWrap, latestBlocks } = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  const cacheTtls: { key: string, ttl: unknown }[] = []
  const latestBlocks: Record<number, { blockNumber: bigint, blockTime: bigint, observedAt: number }> = {}
  const cacheWrap = vi.fn(async (key: string, fn: () => Promise<string>, ttl?: unknown) => {
    cacheTtls.push({ key, ttl })
    if (!store.has(key)) store.set(key, await fn())
    return store.get(key)
  })
  return { store, cacheTtls, cacheWrap, latestBlocks }
})

vi.mock('lib/cache', () => ({ cache: { wrap: cacheWrap } }))
vi.mock('./rpcs', () => ({ latestBlocks }))

import { cachePps } from './pps-cache'

const ADDRESS = '0xAbC0000000000000000000000000000000000123' as const

describe('ingest PPS cache', () => {
  beforeEach(() => {
    store.clear()
    cacheTtls.length = 0
    cacheWrap.mockClear()
    for (const chainId of Object.keys(latestBlocks)) delete latestBlocks[Number(chainId)]
  })

  it('reuses exact bigint PPS values for the same normalized address and block', async () => {
    const expected = 2n ** 255n + 123456789n
    const read = vi.fn(async () => expected)

    const first = await cachePps(1, ADDRESS, 123n, 'yearn:pricePerShare', read, { blockTime: BigInt(Math.floor(Date.now() / 1000)) })
    const second = await cachePps(1, ADDRESS.toLowerCase() as `0x${string}`, 123n, 'yearn:pricePerShare', read)

    expect(first).to.equal(expected)
    expect(second).to.equal(expected)
    expect(read).toHaveBeenCalledTimes(1)
    expect(cacheWrap.mock.calls[0][0]).to.equal(cacheWrap.mock.calls[1][0])
  })

  it('uses a finite short TTL when block age is unknown or near a fresh head', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    latestBlocks[1] = { blockNumber: 10_000n, blockTime: now, observedAt: Date.now() }

    await cachePps(1, ADDRESS, 10_000n, 'unknown', async () => 1n)
    await cachePps(1, ADDRESS, 9_999n, 'stale-time', async () => 2n, { blockTime: now - 7n * 24n * 60n * 60n })

    expect(cacheTtls.map(({ ttl }) => ttl)).to.deep.equal([1000, 15_000])
  })

  it('uses a finite long TTL only for a known historical observation', async () => {
    await cachePps(1, ADDRESS, 100n, 'historical', async () => 3n, { isHistorical: true })

    expect(cacheTtls[0].ttl).to.equal(24 * 60 * 60 * 1000)
  })

  it('does not cache failed reads', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(4n)

    await expect(cachePps(1, ADDRESS, 123n, 'retry', read)).rejects.toThrow('temporary failure')
    expect(await cachePps(1, ADDRESS, 123n, 'retry', read)).to.equal(4n)

    expect(read).toHaveBeenCalledTimes(2)
    expect(store.size).to.equal(1)
  })
})
