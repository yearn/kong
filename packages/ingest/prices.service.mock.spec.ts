import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mqAdd } = vi.hoisted(() => ({ mqAdd: vi.fn() }))

vi.mock('lib', () => ({
  mq: { add: mqAdd, job: { load: { price: { name: 'price' } } } }
}))

vi.mock('lib/blocks', () => ({
  getBlockTime: vi.fn(async () => 1700000000n),
  getBlockNumber: vi.fn(async () => 1n)
}))

vi.mock('lib/cache', () => ({
  cache: {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    wrap: (_key: string, fn: () => Promise<unknown>) => fn()
  }
}))

import { fetchErc20PriceUsd } from './prices'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const CHAIN_ID = 137 // polygon — not in the on-chain `lens` map

describe('fetchErc20PriceUsd (USE_PRICE_SERVICE=true)', () => {
  const originalUsePriceService = process.env.USE_PRICE_SERVICE
  const originalApiKey = process.env.PRICE_SERVICE_API_KEY

  beforeEach(() => {
    process.env.USE_PRICE_SERVICE = 'true'
    process.env.PRICE_SERVICE_API_KEY = 'test-key'
    mqAdd.mockReset()
  })

  afterEach(() => {
    if (originalUsePriceService === undefined) delete process.env.USE_PRICE_SERVICE
    else process.env.USE_PRICE_SERVICE = originalUsePriceService
    if (originalApiKey === undefined) delete process.env.PRICE_SERVICE_API_KEY
    else process.env.PRICE_SERVICE_API_KEY = originalApiKey
    vi.unstubAllGlobals()
  })

  it('returns the price service value and never enqueues', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        coins: {
          ['polygon:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']: {
            symbol: 'WETH',
            prices: [{ timestamp: 1700000000, price: 2, confidence: 1, source: 'defillama' }]
          }
        }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('returns na when the service has nothing — no fallback, no enqueue', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }))
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('na')
    expect(priceUsd).to.equal(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mqAdd).not.toHaveBeenCalled()
  })
})
