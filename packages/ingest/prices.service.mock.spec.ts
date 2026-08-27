import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { blockTime, first, mqAdd, multicall, query } = vi.hoisted(() => ({
  blockTime: vi.fn(), first: vi.fn(), mqAdd: vi.fn(), multicall: vi.fn(), query: vi.fn()
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
  default: { query },
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
const WETH_COIN = 'polygon:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const DAY_END = 1700006399

function batchResponse(prices: Record<string, number>) {
  return {
    ok: true,
    json: async () => ({
      coins: Object.fromEntries(Object.entries(prices).map(([coinId, price]) => [
        coinId, { symbol: 'TOKEN', prices: [{ timestamp: DAY_END, price }] }
      ]))
    })
  }
}

function decodeCoins(url: string) {
  return JSON.parse(decodeURIComponent(new URL(url).searchParams.get('coins')!))
}

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

  it('returns the price service value from one batch call and never enqueues', async () => {
    const fetchMock = vi.fn(async (requested: string) => requested.includes('batchHistorical')
      ? batchResponse({ [WETH_COIN]: 2 })
      : { ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mqAdd).not.toHaveBeenCalled()
    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('https://prices.yearn.dev/api/prices/batchHistorical?coins=')
    expect(decodeCoins(url)).to.deep.equal({ [WETH_COIN]: [1700000000] })
    expect(url).not.toContain('source=')
  })

  it('falls back to the exact endpoint when the batch has no row for the day', async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes('batchHistorical')
      ? batchResponse({})
      : {
        ok: true,
        json: async () => ({ coins: { [WETH_COIN]: { symbol: 'WETH', price: 3 } } })
      })
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).to.equal(`https://prices.yearn.dev/api/prices/historical/1700000000/${WETH_COIN}`)
  })

  it('returns na without an exact call when the batch stores a zero price', async () => {
    const fetchMock = vi.fn(async () => batchResponse({ [WETH_COIN]: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('na')
    expect(priceUsd).to.equal(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the exact endpoint when the batch call fails', async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes('batchHistorical')
      ? { ok: false, status: 500 }
      : { ok: true, json: async () => ({ coins: { [WETH_COIN]: { symbol: 'WETH', price: 4 } } }) })
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(4)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent lookups into one batch call', async () => {
    const other = '0x2222222222222222222222222222222222222222' as const
    const otherCoin = `polygon:${other.toLowerCase()}`
    const fetchMock = vi.fn(async (requested: string) => requested.includes('batchHistorical')
      ? batchResponse({ [WETH_COIN]: 2, [otherCoin]: 7 })
      : { ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)

    const [weth, second, duplicate] = await Promise.all([
      fetchErc20PriceUsd(CHAIN_ID, WETH, 1n),
      fetchErc20PriceUsd(CHAIN_ID, other, 2n),
      fetchErc20PriceUsd(CHAIN_ID, WETH, 3n)
    ])

    expect(weth.priceUsd).to.equal(2)
    expect(second.priceUsd).to.equal(7)
    expect(duplicate.priceUsd).to.equal(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.keys(decodeCoins(fetchMock.mock.calls[0][0]))).to.have.lengthOf(2)
  })

  it('splits more than 50 queued tokens across batch calls', async () => {
    const fetchMock = vi.fn(async (requested: string) => requested.includes('batchHistorical')
      ? batchResponse({})
      : { ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)

    const tokens = Array.from({ length: 51 }, (_, index) =>
      `0x${(index + 1).toString(16).padStart(40, '0')}` as `0x${string}`)

    await Promise.all(tokens.map(token => fetchErc20PriceUsd(CHAIN_ID, token, 1n)))

    const batchCalls = fetchMock.mock.calls.filter(([url]) => url.includes('batchHistorical'))
    expect(batchCalls).to.have.lengthOf(2)
  })

  it('returns na when both the batch and the exact endpoint have nothing — no enqueue', async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes('batchHistorical')
      ? batchResponse({})
      : { ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('na')
    expect(priceUsd).to.equal(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('emits a null tvl row when the service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))

    const price = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)
    const outputs = await processTvl(CHAIN_ID, VAULT, { outputLabel: 'tvl', blockTime: 1700000000n } as never)

    expect(price.priceSource).to.equal('unavailable')
    expect(outputs).to.have.length(1)
    expect(outputs[0].component).to.equal('tvl')
    expect(outputs[0].value).to.equal(null)
  })

  it('emits null usd components when the service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))

    const outputs = await processTvl(CHAIN_ID, VAULT, { outputLabel: 'tvl', blockTime: 1700000000n } as never, true)
    const byComponent = Object.fromEntries(outputs.map(output => [output.component, output.value]))

    expect(byComponent['tvl']).to.equal(null)
    expect(byComponent['delegated']).to.equal(null)
    expect(byComponent['priceUsd']).to.equal(null)
    expect(byComponent['totalAssets']).to.equal(1)
    expect(byComponent['delegatedAssets']).to.equal(0)
  })

  it('emits rows when the service says the price is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))

    const price = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)
    const outputs = await processTvl(CHAIN_ID, VAULT, { outputLabel: 'tvl', blockTime: 1700000000n } as never)

    expect(price.priceSource).to.equal('na')
    expect(outputs).not.to.deep.equal([])
  })
})

describe('fetchErc20PriceUsd (USE_PRICE_SERVICE=false)', () => {
  const originalUsePriceService = process.env.USE_PRICE_SERVICE
  const originalApiKey = process.env.PRICE_SERVICE_API_KEY

  beforeEach(() => {
    process.env.USE_PRICE_SERVICE = 'false'
    process.env.PRICE_SERVICE_API_KEY = 'test-key'
    mqAdd.mockReset()
    query.mockReset().mockResolvedValue({ rows: [] })
    blockTime.mockReset().mockResolvedValue(1700000000n)
  })

  afterEach(() => {
    if (originalUsePriceService === undefined) delete process.env.USE_PRICE_SERVICE
    else process.env.USE_PRICE_SERVICE = originalUsePriceService
    if (originalApiKey === undefined) delete process.env.PRICE_SERVICE_API_KEY
    else process.env.PRICE_SERVICE_API_KEY = originalApiKey
    vi.unstubAllGlobals()
  })

  it('reaches the price service through the exact endpoint, never the batch route', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ coins: { [WETH_COIN]: { symbol: 'WETH', price: 3 } } })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { priceSource, priceUsd } = await fetchErc20PriceUsd(CHAIN_ID, WETH, 1n)

    expect(priceSource).to.equal('priceservice')
    expect(priceUsd).to.equal(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/prices/historical/1700000000/')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('batchHistorical'))).to.equal(false)
  })
})
