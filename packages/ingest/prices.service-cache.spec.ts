import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cacheGet = vi.fn()
const cacheSet = vi.fn()

vi.mock('lib/blocks', () => ({
  getBlockTime: vi.fn(async () => 1700000000n),
  getBlockNumber: vi.fn(async () => 1n)
}))

vi.mock('lib/cache', () => ({
  cache: { get: cacheGet, set: cacheSet, wrap: (_key: string, fn: () => Promise<unknown>) => fn() }
}))

// `lib`'s barrel re-exports `../ingest/prices` (circular), and vitest.setup.ts
// imports `lib` before this file's vi.mock calls run. That force-loads the real
// (unmocked) ./prices + lib/blocks into the shared module cache first (isolate:
// false), so a plain top-level `import './prices'` here would silently bind to
// the unmocked module. Reset + re-import dynamically so it re-resolves against
// the mocks declared above.
vi.resetModules()
const { fetchErc20PriceUsd } = await import('./prices')

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const CHAIN_ID = 137 // polygon — not in the on-chain `lens` map

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
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        coins: {
          ['polygon:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']: {
            symbol: 'WETH',
            prices: [{ timestamp: 1700000000, price: 2, confidence: 1, source: 'defillama' }]
          }
        }
      })
    })))

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(2)
    expect(cacheSet).toHaveBeenCalledTimes(1)
    const [key] = cacheSet.mock.calls[0]
    expect(key).toContain(':service:')
    expect(key).toContain(':137:')
  })

  it('does NOT cache an unknown (na) result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('na')
    expect(priceUsd).to.equal(0)
    expect(cacheSet).not.toHaveBeenCalled()
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
})
