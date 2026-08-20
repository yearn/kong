import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { blockTime, first, mqAdd, multicall } = vi.hoisted(() => ({
  blockTime: vi.fn(), first: vi.fn(), mqAdd: vi.fn(), multicall: vi.fn()
}))

vi.mock('lib', () => ({
  mq: { add: mqAdd, job: { load: { price: { name: 'price' } } } }
}))

vi.mock('lib/blocks', () => ({
  getBlockTime: blockTime,
  getBlockNumber: vi.fn(async () => 1n),
  estimateHeight: vi.fn(async () => 1n),
  getBlock: vi.fn(async () => ({ number: 1n }))
}))

vi.mock('lib/cache', () => ({
  cache: {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    wrap: (_key: string, fn: () => Promise<unknown>) => fn()
  }
}))

vi.mock('./db', () => ({
  default: { query: vi.fn() },
  first
}))

vi.mock('./rpcs', () => ({
  rpcs: { next: () => ({ multicall }) }
}))

vi.mock('./abis/yearn/2/vault/snapshot/hook', () => ({
  extractWithdrawalQueue: vi.fn()
}))

import { fetchErc20PriceUsd } from './prices'
import processTvl from './abis/yearn/lib/tvl'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const VAULT = '0x1111111111111111111111111111111111111111' as const
const CHAIN_ID = 137 // polygon — not in the on-chain `lens` map

describe('fetchErc20PriceUsd (USE_PRICE_SERVICE=true)', () => {
  const originalUsePriceService = process.env.USE_PRICE_SERVICE
  const originalApiKey = process.env.PRICE_SERVICE_API_KEY

  beforeEach(() => {
    process.env.USE_PRICE_SERVICE = 'true'
    process.env.PRICE_SERVICE_API_KEY = 'test-key'
    mqAdd.mockReset()
    blockTime.mockReset().mockResolvedValue(1700000000n)
    first.mockReset().mockResolvedValue({
      chainId: CHAIN_ID,
      address: VAULT,
      defaults: { asset: WETH, decimals: 18 }
    })
    multicall.mockReset().mockResolvedValue([
      { status: 'success', result: 1_000_000_000_000_000_000n },
      { status: 'failure' }
    ])
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
            price: 2
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
    expect(fetchMock.mock.calls[0][0]).to.equal('https://prices.yearn.dev/api/prices/historical/1700000000/polygon:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
    expect(fetchMock.mock.calls[0][0]).not.toContain('source=')
  })

  it('returns na when the service says the price is missing — no fallback, no enqueue', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('na')
    expect(priceUsd).to.equal(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('does not emit tvl rows when the service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))

    const outputs = await processTvl(CHAIN_ID, VAULT, { outputLabel: 'tvl', blockTime: 1700000000n } as never)

    expect(outputs).to.deep.equal([])
  })

  it('does not emit componentized priceUsd rows when the service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))

    const outputs = await processTvl(CHAIN_ID, VAULT, { outputLabel: 'tvl', blockTime: 1700000000n } as never, true)

    expect(outputs).to.deep.equal([])
  })

  it('emits rows when the service says the price is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))

    const price = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)
    const outputs = await processTvl(CHAIN_ID, VAULT, { outputLabel: 'tvl', blockTime: 1700000000n } as never)

    expect(price.priceSource).to.equal('na')
    expect(outputs).not.to.deep.equal([])
  })
})
