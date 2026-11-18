import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { blockTime, getBlockNumber, cacheGet, cacheSet, cacheDel, captureMessage } = vi.hoisted(() => ({
  blockTime: vi.fn<(chainId: number, blockNumber?: bigint) => Promise<bigint>>(),
  getBlockNumber: vi.fn<() => Promise<bigint>>(async () => 123n),
  cacheGet: vi.fn(async () => undefined),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
  captureMessage: vi.fn()
}))

vi.mock('lib', () => ({ mq: {} }))
vi.mock('lib/blocks', () => ({ getBlockTime: blockTime, getBlockNumber }))
vi.mock('lib/cache', () => ({
  cache: {
    get: cacheGet,
    set: cacheSet,
    del: cacheDel,
    keys: vi.fn(async () => []),
    wrap: (_key: string, fn: () => Promise<unknown>) => fn()
  }
}))
vi.mock('lib/sentry', () => ({ captureMessage }))

import { fetchErc20PriceUsd } from './prices'

const TOKEN = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const COIN = `polygon:${TOKEN.toLowerCase()}`
const CHAIN_ID = 137
type ServiceResponse = {
  ok: boolean
  json: () => Promise<{ coins: Record<string, { symbol: string, prices: { timestamp: number, price: number }[] }> }>
}

describe('fetchErc20PriceUsd timestamp reuse', () => {
  const originalApiKey = process.env.PRICE_SERVICE_API_KEY

  beforeEach(() => {
    process.env.PRICE_SERVICE_API_KEY = 'test-key'
    blockTime.mockReset().mockResolvedValue(1700000000n)
    getBlockNumber.mockClear()
    cacheGet.mockReset().mockResolvedValue(undefined)
    cacheSet.mockClear()
    cacheDel.mockClear()
    vi.stubGlobal('fetch', undefined)
  })

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.PRICE_SERVICE_API_KEY
    else process.env.PRICE_SERVICE_API_KEY = originalApiKey
    vi.unstubAllGlobals()
  })

  it('uses the supplied current-day timestamp and treats block zero as explicit', async () => {
    const knownBlockTime = BigInt(Math.floor(Date.now() / 1000))
    const dayEnd = Math.floor(Number(knownBlockTime) / 86400) * 86400 + 86399
    const fetchMock = vi.fn<(url: string) => Promise<ServiceResponse>>(async () => ({
      ok: true,
      json: async () => ({ coins: { [COIN]: { symbol: 'TOKEN', prices: [{ timestamp: dayEnd, price: 2 }] } } })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchErc20PriceUsd(CHAIN_ID, TOKEN, 0n, false, knownBlockTime)

    expect(result).toMatchObject({ chainId: CHAIN_ID, address: TOKEN, blockNumber: 0n, blockTime: knownBlockTime, priceUsd: 2, priceSource: 'priceservice' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(decodeURIComponent(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('coins')!)))
      .toEqual({ [COIN]: [Number(knownBlockTime)] })
    expect(blockTime).not.toHaveBeenCalled()
    expect(getBlockNumber).not.toHaveBeenCalled()
  })

  it('reuses the supplied timestamp through an unsuccessful historical lookup', async () => {
    const knownBlockTime = 1700000000n
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))

    const result = await fetchErc20PriceUsd(CHAIN_ID, TOKEN, 1n, false, knownBlockTime)

    expect(result).toMatchObject({ chainId: CHAIN_ID, address: TOKEN, blockNumber: 1n, blockTime: knownBlockTime, priceUsd: 0, priceSource: 'na' })
    expect(blockTime).not.toHaveBeenCalled()
  })
})
