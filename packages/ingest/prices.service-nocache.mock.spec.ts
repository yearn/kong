import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('lib/blocks', () => ({
  getBlockTime: vi.fn(async () => 1700000000n),
  getBlockNumber: vi.fn(async () => 1n)
}))

import { fetchErc20PriceUsd } from './prices'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const CHAIN_ID = 137

describe('fetchErc20PriceUsd (service mode, cache never upped)', () => {
  const originalUsePriceService = process.env.USE_PRICE_SERVICE
  const originalApiKey = process.env.PRICE_SERVICE_API_KEY

  beforeEach(() => {
    process.env.USE_PRICE_SERVICE = 'true'
    process.env.PRICE_SERVICE_API_KEY = 'test-key'
  })

  afterEach(() => {
    if (originalUsePriceService === undefined) delete process.env.USE_PRICE_SERVICE
    else process.env.USE_PRICE_SERVICE = originalUsePriceService
    if (originalApiKey === undefined) delete process.env.PRICE_SERVICE_API_KEY
    else process.env.PRICE_SERVICE_API_KEY = originalApiKey
    vi.unstubAllGlobals()
  })

  it('returns a price for a past-day block instead of rejecting', async () => {
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
  })
})
