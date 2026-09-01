import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheGet, cacheSet, cacheDel, cacheKeys, blockTime, wrapStore, wrapTtls } = vi.hoisted(() => ({
  cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn(), cacheKeys: vi.fn(), blockTime: vi.fn(),
  wrapStore: new Map<string, unknown>(), wrapTtls: [] as unknown[]
}))

vi.mock('lib/blocks', () => ({
  getBlockTime: blockTime,
  getBlockNumber: vi.fn(async () => 1n)
}))

vi.mock('lib/cache', () => ({
  cache: {
    get: cacheGet,
    set: cacheSet,
    del: cacheDel,
    keys: cacheKeys,
    wrap: async (key: string, fn: () => Promise<unknown>, ttl?: unknown) => {
      wrapTtls.push(ttl)
      if (!wrapStore.has(key)) wrapStore.set(key, await fn())
      return wrapStore.get(key)
    }
  }
}))

import { clearNegativePriceCache, fetchErc20PriceUsd } from './prices'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const WETH_COIN = 'polygon:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const CHAIN_ID = 137 // polygon — not in the on-chain `lens` map

const endOfDay = (timestamp: number) => Math.floor(timestamp / 86400) * 86400 + 86399

// Mirrors batchHistorical: echoes the requested keys, answers at end-of-day.
function batchHit(price: number) {
  return vi.fn(async (url: string) => {
    const coins = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('coins')!)) as Record<string, number[]>
    return {
      ok: true,
      json: async () => ({
        coins: Object.fromEntries(Object.entries(coins).map(([coinId, timestamps]) => [
          coinId,
          { symbol: 'TOKEN', prices: timestamps.map(timestamp => ({ timestamp: endOfDay(timestamp), price })) }
        ]))
      })
    }
  })
}

function batchMissThenExact(exact: { ok: boolean, status?: number, price?: number }) {
  return vi.fn(async (url: string) => url.includes('batchHistorical')
    ? { ok: true, json: async () => ({ coins: {} }) }
    : exact.ok
      ? { ok: true, json: async () => ({ coins: { [WETH_COIN]: { symbol: 'WETH', price: exact.price } } }) }
      : { ok: false, status: exact.status })
}

describe('fetchErc20PriceUsd (USE_PRICE_SERVICE, past-day path)', () => {
  const originalUsePriceService = process.env.USE_PRICE_SERVICE
  const originalApiKey = process.env.PRICE_SERVICE_API_KEY
  const originalYpriceEnabled = process.env.YPRICE_ENABLED

  beforeEach(() => {
    process.env.USE_PRICE_SERVICE = 'true'
    process.env.PRICE_SERVICE_API_KEY = 'test-key'
    delete process.env.YPRICE_ENABLED

    cacheGet.mockReset().mockResolvedValue(undefined)
    cacheSet.mockReset()
    cacheDel.mockReset()
    cacheKeys.mockReset().mockResolvedValue([])
    blockTime.mockReset().mockResolvedValue(1700000000n)
    wrapStore.clear()
    wrapTtls.length = 0
  })

  afterEach(() => {
    if (originalUsePriceService === undefined) delete process.env.USE_PRICE_SERVICE
    else process.env.USE_PRICE_SERVICE = originalUsePriceService
    if (originalApiKey === undefined) delete process.env.PRICE_SERVICE_API_KEY
    else process.env.PRICE_SERVICE_API_KEY = originalApiKey
    if (originalYpriceEnabled === undefined) delete process.env.YPRICE_ENABLED
    else process.env.YPRICE_ENABLED = originalYpriceEnabled

    vi.unstubAllGlobals()
  })

  it('caches a service hit under the day key', async () => {
    vi.stubGlobal('fetch', batchHit(2))

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(2)
    expect(cacheSet).toHaveBeenCalledTimes(1)
    const [key] = cacheSet.mock.calls[0]
    expect(key).toContain(':service:')
    expect(key).toContain(':137:')
  })

  it('holds a service hit in the block cache for the head-block window', async () => {
    vi.stubGlobal('fetch', batchHit(2))

    await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    const ttl = wrapTtls.at(-1) as (result: { priceSource: string }) => number
    expect(typeof ttl).to.equal('function')
    expect(ttl({ priceSource: 'priceservice' })).to.equal(15 * 60 * 1000)
    expect(ttl({ priceSource: 'na' })).to.equal(120_000)
    expect(ttl({ priceSource: 'unavailable' })).to.equal(120_000)
  })

  it('caches an unknown result under a short-lived negative marker', async () => {
    vi.stubGlobal('fetch', batchMissThenExact({ ok: false, status: 404 }))

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('na')
    expect(priceUsd).to.equal(0)
    expect(cacheSet).toHaveBeenCalledTimes(2)
    const [key, marker, ttl] = cacheSet.mock.calls[0]
    expect(key).toContain(':service:')
    expect(marker).to.deep.equal({ type: 'price-service-negative', priceSource: 'na' })
    expect(ttl).to.equal(120_000)
    expect(ttl).not.to.equal(24 * 60 * 60 * 1000)
    const [attemptsKey, attempts, attemptsTtl] = cacheSet.mock.calls[1]
    expect(attemptsKey).to.equal(`${key}:attempts`)
    expect(attempts).to.equal(1)
    expect(attemptsTtl).to.equal(24 * 60 * 60 * 1000)
  })

  it('does not promote a literal zero price into the day cache', async () => {
    vi.stubGlobal('fetch', batchHit(0))

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('na')
    expect(priceUsd).to.equal(0)
    expect(cacheSet).toHaveBeenCalledTimes(2)
    const [, marker, ttl] = cacheSet.mock.calls[0]
    expect(marker).to.deep.equal({ type: 'price-service-negative', priceSource: 'na' })
    expect(ttl).to.equal(120_000)
  })

  it('issues no further calls for repeat misses of the same block', async () => {
    const fetchMock = batchMissThenExact({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)
    const callsAfterFirst = fetchMock.mock.calls.length
    const second = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(first.priceSource).to.equal('na')
    expect(second.priceSource).to.equal('na')
    expect(callsAfterFirst).to.equal(2) // batch miss, then the exact endpoint
    expect(fetchMock.mock.calls.length).to.equal(callsAfterFirst)
    expect(cacheSet).toHaveBeenCalledTimes(4)
  })

  it('doubles the negative ttl on repeat failures, capped at 6h', async () => {
    const store = new Map<string, unknown>()
    cacheGet.mockImplementation(async (key: string) => store.get(key))
    const markerTtls: number[] = []
    cacheSet.mockImplementation(async (key: string, value: unknown, ttl?: number) => {
      store.set(key, value)
      if (!key.endsWith(':attempts')) markerTtls.push(ttl as number)
    })
    vi.stubGlobal('fetch', batchMissThenExact({ ok: false, status: 503 }))

    for (let attempt = 0; attempt < 10; attempt++) {
      const { priceSource } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)
      expect(priceSource).to.equal('unavailable')
      for (const key of store.keys()) if (!key.endsWith(':attempts')) store.delete(key)
      wrapStore.clear()
    }

    expect(markerTtls.slice(0, 3)).to.deep.equal([120_000, 240_000, 480_000])
    expect(markerTtls.at(-1)).to.equal(6 * 60 * 60 * 1000)
  })

  it('clears negative markers and attempt counters, keeps cached prices', async () => {
    const prefix = 'fetchErc20PriceUsd:service:v2:137:'
    const store = new Map<string, unknown>([
      [`${prefix}${WETH}:1699920000`, { type: 'price-service-negative', priceSource: 'unavailable' }],
      [`${prefix}${WETH}:1699920000:attempts`, 5],
      [`${prefix}${WETH}:1699833600`, { chainId: CHAIN_ID, address: WETH, priceUsd: 2, priceSource: 'priceservice', blockNumber: 1n, blockTime: 1699833600n }]
    ])
    cacheKeys.mockResolvedValue([...store.keys()])
    cacheGet.mockImplementation(async (key: string) => store.get(key))
    cacheDel.mockImplementation(async (key: string) => { store.delete(key) })

    await clearNegativePriceCache()

    expect([...store.keys()]).to.deep.equal([`${prefix}${WETH}:1699833600`])
  })

  it('returns a cached value without refetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    cacheGet.mockResolvedValue({
      chainId: CHAIN_ID,
      address: WETH,
      priceUsd: 5,
      priceSource: 'priceservice',
      blockNumber: 1n,
      blockTime: 1700000000n
    })

    const { priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceUsd).to.equal(5)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches once for many blocks in the same utc day', async () => {
    const store = new Map<string, unknown>()
    cacheGet.mockImplementation(async (key: string) => store.get(key))
    cacheSet.mockImplementation(async (key: string, value: unknown) => { store.set(key, value) })

    const fetchMock = batchHit(2)
    vi.stubGlobal('fetch', fetchMock)

    for (const blockNumber of [1n, 2n, 3n, 4n]) {
      const { priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, blockNumber)
      expect(priceUsd).to.equal(2)
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops calling out for distinct past-day blocks after an unavailable response', async () => {
    const store = new Map<string, unknown>()
    cacheGet.mockImplementation(async (key: string) => store.get(key))
    cacheSet.mockImplementation(async (key: string, value: unknown) => { store.set(key, value) })
    const fetchMock = batchMissThenExact({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock)

    for (const blockNumber of [1n, 2n, 3n, 4n]) {
      const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, blockNumber)
      expect(priceSource).to.equal('unavailable')
      expect(priceUsd).to.equal(0)
    }

    expect(fetchMock).toHaveBeenCalledTimes(4) // batch miss, then exact endpoint retried through 5xx
  })

  it('skips the day key for a current-day block (routes through the block cache)', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    blockTime.mockResolvedValue(BigInt(nowSec))

    const fetchMock = batchHit(2)
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(2)
    expect(cacheGet).not.toHaveBeenCalled()
    expect(cacheSet).not.toHaveBeenCalled()
  })

  it('skips the day cache entirely with no blockNumber (latest path)', async () => {
    blockTime.mockResolvedValue(1700000000n) // past day — would hit the day-cache branch if latest weren't set

    const fetchMock = batchHit(2)
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(2)
    expect(cacheGet).not.toHaveBeenCalled()
    expect(cacheSet).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
