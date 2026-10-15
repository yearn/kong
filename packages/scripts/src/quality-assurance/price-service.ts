/**
 * Historical price lookups against the Yearn Price Service (https://prices.yearn.dev).
 *
 * Mirrors packages/ingest/prices.ts: same env vars (PRICE_SERVICE_API_KEY, PRICE_SERVICE_URL),
 * same chain names, batchHistorical first and the exact historical route for misses (batch only
 * reads the service's table; the exact route also resolves upstream). Adds retry with backoff on
 * 429/5xx/network errors because a backfill fires many requests in a row.
 *
 * Never guesses: a token/day the service can't price is reported as missing, and zero or
 * non-finite prices are treated as missing so callers never write tvl=0 from a gap.
 */

export const PRICE_SERVICE_DEFAULT_URL = 'https://prices.yearn.dev'

/** Must match price-service CHAIN_ID_TO_NAME (gnosis, not xdai). Same map as packages/ingest/prices.ts. */
export const PRICE_SERVICE_CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum', 10: 'optimism', 100: 'gnosis', 137: 'polygon',
  146: 'sonic', 250: 'fantom', 8453: 'base', 42161: 'arbitrum',
  80094: 'berachain', 747474: 'katana', 4663: 'robinhood',
}

const DAY_SECONDS = 86_400
// The service caps distinct coins and per-coin timestamps per batch; 50 entries stays under both
// (same cap as ingest's BATCH_MAX_ENTRIES).
export const BATCH_MAX_ENTRIES = 50
const EXACT_CONCURRENCY = 4

export interface PriceServiceConfig {
  apiKey: string
  baseUrl: string
}

export function getPriceServiceConfig(env: Record<string, string | undefined> = process.env): PriceServiceConfig | undefined {
  const apiKey = env.PRICE_SERVICE_API_KEY?.trim()
  if (!apiKey) return undefined
  return { apiKey, baseUrl: (env.PRICE_SERVICE_URL?.trim() || PRICE_SERVICE_DEFAULT_URL).replace(/\/+$/, '') }
}

export function utcDayStart(timestamp: number): number {
  return Math.floor(timestamp / DAY_SECONDS) * DAY_SECONDS
}

export function toPriceServiceCoinId(chainId: number, address: string): string | undefined {
  const chainName = PRICE_SERVICE_CHAIN_NAMES[chainId]
  return chainName ? `${chainName}:${address.toLowerCase()}` : undefined
}

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

/** fetch with exponential backoff on 429, 5xx and network errors. Returns the last response otherwise. */
export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions = {}): Promise<Response> {
  const { retries = 4, baseDelayMs = 500, maxDelayMs = 15_000, fetchImpl = fetch, sleepImpl = defaultSleep } = options
  for (let attempt = 0; ; attempt++) {
    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
    try {
      const response = await fetchImpl(url, init)
      if (!isRetryableStatus(response.status) || attempt >= retries) return response
      await sleepImpl(Math.min(maxDelayMs, retryAfterMs(response) ?? backoff))
    } catch (error) {
      if (attempt >= retries) throw error
      await sleepImpl(backoff)
    }
  }
}

function validPrice(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

type CoinsResponse = { coins?: Record<string, { prices?: { timestamp: number; price: number }[]; price?: number }> }

export interface PriceRequest {
  coinId: string
  timestamp: number
}

export interface PriceServiceResult {
  /** coinId (lowercase) -> utc day start -> priceUsd */
  prices: Map<string, Map<number, number>>
  /** requests the service answered with no usable price (404, empty, zero) */
  missing: PriceRequest[]
  /** requests that failed for transport reasons after retries (non-404 errors) */
  failed: { request: PriceRequest; reason: string }[]
  stats: { batchRequests: number; batchHits: number; exactRequests: number; exactHits: number }
}

function setPrice(prices: Map<string, Map<number, number>>, coinId: string, timestamp: number, price: number) {
  let byDay = prices.get(coinId)
  if (!byDay) prices.set(coinId, byDay = new Map())
  byDay.set(utcDayStart(timestamp), price)
}

/**
 * Resolve historical prices for (coinId, timestamp) pairs. Timestamps are normalized to UTC days
 * by the service; results are keyed by utcDayStart(timestamp).
 */
export async function fetchPriceServiceHistoricalPrices(
  requests: PriceRequest[],
  config: PriceServiceConfig,
  options: RetryOptions & { log?: (message: string) => void } = {}
): Promise<PriceServiceResult> {
  const log = options.log ?? (message => console.warn(message))
  const headers = { Authorization: `Bearer ${config.apiKey}` }
  const result: PriceServiceResult = {
    prices: new Map(),
    missing: [],
    failed: [],
    stats: { batchRequests: 0, batchHits: 0, exactRequests: 0, exactHits: 0 },
  }

  // Dedupe on coin + utc day; the service would answer them identically.
  const unique = new Map<string, PriceRequest>()
  for (const request of requests) {
    const coinId = request.coinId.toLowerCase()
    unique.set(`${coinId}:${utcDayStart(request.timestamp)}`, { coinId, timestamp: request.timestamp })
  }
  const pending = [...unique.values()]
  const misses: PriceRequest[] = []

  for (let i = 0; i < pending.length; i += BATCH_MAX_ENTRIES) {
    const chunk = pending.slice(i, i + BATCH_MAX_ENTRIES)
    const coins: Record<string, number[]> = {}
    for (const entry of chunk) (coins[entry.coinId] ??= []).push(entry.timestamp)
    const url = `${config.baseUrl}/api/prices/batchHistorical?coins=${encodeURIComponent(JSON.stringify(coins))}`
    result.stats.batchRequests++
    try {
      const response = await fetchWithRetry(url, { headers }, options)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as CoinsResponse
      // The service echoes the key it parsed, which checksums the address.
      const byCoin = new Map(Object.entries(data.coins ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
      for (const entry of chunk) {
        const day = utcDayStart(entry.timestamp)
        const hit = byCoin.get(entry.coinId)?.prices?.find(p => utcDayStart(p.timestamp) === day)
        const price = validPrice(hit?.price)
        if (price === undefined) { misses.push(entry); continue }
        setPrice(result.prices, entry.coinId, entry.timestamp, price)
        result.stats.batchHits++
      }
    } catch (error) {
      // A broken batch call falls through to the exact route, same as a table miss.
      log(`  price service batchHistorical failed for ${chunk.length} entries: ${error instanceof Error ? error.message : String(error)}`)
      misses.push(...chunk)
    }
  }

  // Exact route for misses, small concurrency to stay polite.
  let next = 0
  const worker = async () => {
    while (next < misses.length) {
      const entry = misses[next++]
      result.stats.exactRequests++
      const url = `${config.baseUrl}/api/prices/historical/${entry.timestamp}/${entry.coinId}`
      try {
        const response = await fetchWithRetry(url, { headers }, options)
        if (response.status === 404) { result.missing.push(entry); continue }
        if (!response.ok) { result.failed.push({ request: entry, reason: `HTTP ${response.status}` }); continue }
        const data = await response.json() as CoinsResponse
        const coin = Object.entries(data.coins ?? {}).find(([key]) => key.toLowerCase() === entry.coinId)?.[1]
        const price = validPrice(coin?.prices?.[0]?.price ?? coin?.price)
        if (price === undefined) { result.missing.push(entry); continue }
        setPrice(result.prices, entry.coinId, entry.timestamp, price)
        result.stats.exactHits++
      } catch (error) {
        result.failed.push({ request: entry, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(EXACT_CONCURRENCY, misses.length) }, worker))

  return result
}
