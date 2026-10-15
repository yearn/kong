import { describe, expect, it } from 'bun:test'
import {
  BATCH_MAX_ENTRIES,
  fetchPriceServiceHistoricalPrices,
  fetchWithRetry,
  getPriceServiceConfig,
  toPriceServiceCoinId,
  utcDayStart,
} from './price-service'

const config = { apiKey: 'test-key', baseUrl: 'https://prices.test' }
const noSleep = async () => {}
const DAY = 1760399999 // 2025-10-13T23:59:59Z
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url)
    return handler(url)
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('config', () => {
  it('requires a non-blank key and defaults the url', () => {
    expect(getPriceServiceConfig({})).toBeUndefined()
    expect(getPriceServiceConfig({ PRICE_SERVICE_API_KEY: '  ' })).toBeUndefined()
    expect(getPriceServiceConfig({ PRICE_SERVICE_API_KEY: 'k' })).toEqual({ apiKey: 'k', baseUrl: 'https://prices.yearn.dev' })
    expect(getPriceServiceConfig({ PRICE_SERVICE_API_KEY: 'k', PRICE_SERVICE_URL: 'http://x/' })?.baseUrl).toBe('http://x')
  })

  it('maps chains with price-service names', () => {
    expect(toPriceServiceCoinId(100, '0xABC')).toBe('gnosis:0xabc')
    expect(toPriceServiceCoinId(4663, '0xABC')).toBe('robinhood:0xabc')
    expect(toPriceServiceCoinId(999, '0xABC')).toBeUndefined()
  })
})

describe('fetchWithRetry', () => {
  it('retries 429 and 5xx then succeeds', async () => {
    const statuses = [429, 503, 200]
    const { fetchImpl, calls } = mockFetch(() => new Response('', { status: statuses.shift() }))
    const response = await fetchWithRetry('https://prices.test/x', {}, { fetchImpl, sleepImpl: noSleep })
    expect(response.status).toBe(200)
    expect(calls.length).toBe(3)
  })

  it('does not retry 404', async () => {
    const { fetchImpl, calls } = mockFetch(() => new Response('', { status: 404 }))
    const response = await fetchWithRetry('https://prices.test/x', {}, { fetchImpl, sleepImpl: noSleep })
    expect(response.status).toBe(404)
    expect(calls.length).toBe(1)
  })

  it('gives up after the retry budget', async () => {
    const { fetchImpl, calls } = mockFetch(() => new Response('', { status: 500 }))
    const response = await fetchWithRetry('https://prices.test/x', {}, { fetchImpl, sleepImpl: noSleep, retries: 2 })
    expect(response.status).toBe(500)
    expect(calls.length).toBe(3)
  })
})

describe('fetchPriceServiceHistoricalPrices', () => {
  it('uses batch hits and falls back to the exact route for misses', async () => {
    const { fetchImpl, calls } = mockFetch(url => {
      if (url.pathname === '/api/prices/batchHistorical') {
        // checksummed echo, one hit, one zero (treated as miss)
        return json({ coins: {
          'ethereum:0xAAA': { prices: [{ timestamp: DAY - 100, price: 1.0001 }] },
          'ethereum:0xBBB': { prices: [{ timestamp: DAY, price: 0 }] },
        } })
      }
      if (url.pathname === `/api/prices/historical/${DAY}/ethereum:0xbbb`) {
        return json({ coins: { 'ethereum:0xBBB': { prices: [{ timestamp: DAY, price: 2500 }] } } })
      }
      return new Response('', { status: 404 })
    })

    const result = await fetchPriceServiceHistoricalPrices([
      { coinId: 'ethereum:0xAAA', timestamp: DAY },
      { coinId: 'ethereum:0xaaa', timestamp: DAY }, // dupe
      { coinId: 'ethereum:0xbbb', timestamp: DAY },
      { coinId: 'ethereum:0xccc', timestamp: DAY },
    ], config, { fetchImpl, sleepImpl: noSleep, log: () => {} })

    expect(result.prices.get('ethereum:0xaaa')?.get(utcDayStart(DAY))).toBe(1.0001)
    expect(result.prices.get('ethereum:0xbbb')?.get(utcDayStart(DAY))).toBe(2500)
    expect(result.prices.has('ethereum:0xccc')).toBe(false)
    expect(result.missing).toEqual([{ coinId: 'ethereum:0xccc', timestamp: DAY }])
    expect(result.stats).toEqual({ batchRequests: 1, batchHits: 1, exactRequests: 2, exactHits: 1 })
    expect(calls.length).toBe(3)
  })

  it('chunks batch requests', async () => {
    const requests = Array.from({ length: BATCH_MAX_ENTRIES + 1 }, (_, i) => ({ coinId: 'ethereum:0xaaa', timestamp: DAY + i * 86400 }))
    const { fetchImpl, calls } = mockFetch(url => {
      const coins = JSON.parse(url.searchParams.get('coins')!) as Record<string, number[]>
      return json({ coins: { 'ethereum:0xaaa': { prices: coins['ethereum:0xaaa'].map(timestamp => ({ timestamp, price: 1 })) } } })
    })
    const result = await fetchPriceServiceHistoricalPrices(requests, config, { fetchImpl, sleepImpl: noSleep })
    expect(calls.filter(c => c.pathname.endsWith('batchHistorical')).length).toBe(2)
    expect(result.prices.get('ethereum:0xaaa')?.size).toBe(BATCH_MAX_ENTRIES + 1)
  })

  it('reports transport failures without inventing prices', async () => {
    const { fetchImpl } = mockFetch(() => new Response('', { status: 502 }))
    const result = await fetchPriceServiceHistoricalPrices(
      [{ coinId: 'ethereum:0xaaa', timestamp: DAY }], config,
      { fetchImpl, sleepImpl: noSleep, retries: 1, log: () => {} }
    )
    expect(result.prices.size).toBe(0)
    expect(result.failed).toEqual([{ request: { coinId: 'ethereum:0xaaa', timestamp: DAY }, reason: 'HTTP 502' }])
  })

  it('sends the bearer key', async () => {
    let auth = null as string | null
    const fetchImpl = (async (_: unknown, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('authorization')
      return json({ coins: {} })
    }) as typeof fetch
    await fetchPriceServiceHistoricalPrices([{ coinId: 'ethereum:0xaaa', timestamp: DAY }], config, { fetchImpl, sleepImpl: noSleep })
    expect(auth).toBe('Bearer test-key')
  })
})
