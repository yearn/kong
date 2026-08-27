import { mq } from 'lib'
import { getBlockNumber, getBlockTime } from 'lib/blocks'
import { cache } from 'lib/cache'
import { Price, PriceSchema } from 'lib/types'
import { getAddress, parseAbi } from 'viem'
import { arbitrum, base, fantom, mainnet, optimism } from 'viem/chains'
import db from './db'
import { rpcs } from './rpcs'

export const lens = {
  [mainnet.id]: '0x83d95e0D5f402511dB06817Aff3f9eA88224B030' as `0x${string}`,
  [optimism.id]: '0xB082d9f4734c535D9d80536F7E87a6f4F471bF65' as `0x${string}`,
  [fantom.id]: '0x57AA88A0810dfe3f9b71a9b179Dd8bF5F956C46A' as `0x${string}`,
  [base.id]: '0xE0F3D78DB7bC111996864A32d22AB0F59Ca5Fa86' as `0x${string}`,
  [arbitrum.id]: '0x043518AB266485dC085a1DB095B8d9C2Fc78E9b9' as `0x${string}`
}

const DAY_SECONDS = 86_400
const PAST_DAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const PAST_DAY_NEGATIVE_CACHE_TTL_MS = 120_000
const BLOCK_CACHE_TTL_MS = 30_000
// lib/blocks pins the head block for 15m and the service refreshes today's row hourly, so a 30s
// ttl re-fetched an unchanged value ~120x/h per token.
const SERVICE_BLOCK_CACHE_TTL_MS = 15 * 60 * 1000

/** When true, indexer reads prices from yearn-prices and skips the Postgres price table. */
export function usePriceService(): boolean {
  return (process.env.USE_PRICE_SERVICE || '').trim().toLowerCase() === 'true'
}

/** Fail closed when service mode lacks a key. Call from ingest startup. */
export function assertPriceSourceConfig(): void {
  if (usePriceService() && !process.env.PRICE_SERVICE_API_KEY) {
    throw new Error('USE_PRICE_SERVICE=true requires PRICE_SERVICE_API_KEY')
  }
}

/** UTC day start (unix seconds): floor(ts/86400)*86400 — cache key, not service day-end. */
export function utcDayStart(blockTime: bigint | number): number {
  return Math.floor(Number(blockTime) / DAY_SECONDS) * DAY_SECONDS
}

export function isCurrentUtcDay(blockTime: bigint | number, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return utcDayStart(blockTime) === utcDayStart(nowSec)
}

export async function fetchErc20PriceUsd(chainId: number, token: `0x${string}`, blockNumber?: bigint, latest = false): Promise<{ priceUsd: number, priceSource: string }>{
  token = getAddress(token)

  if (!blockNumber) {
    blockNumber = await getBlockNumber(chainId)
    latest = true
  }
  const blockCacheKey = `fetchErc20PriceUsd:${chainId}:${token}:${blockNumber}`

  if (usePriceService() && !latest) {
    const blockTime = await getBlockTime(chainId, blockNumber)
    if (!isCurrentUtcDay(blockTime)) {
      const day = utcDayStart(blockTime)
      // v2: don't reuse entries a prior trial wrote under the old key.
      const key = `fetchErc20PriceUsd:service:v2:${chainId}:${token}:${day}`
      const cached = await cache.get(key)
      if (isPriceServiceNegativeCacheMarker(cached)) return { priceUsd: 0, priceSource: cached.priceSource }
      const parsed = PriceSchema.safeParse(cached)
      if (parsed.success) return parsed.data
      const result = await cache.wrap(
        blockCacheKey,
        async () => __fetchErc20PriceUsd(chainId, token, blockNumber!, latest, blockTime),
        blockCacheTtl()
      )
      // Only a day-granular service result is safe under a day key: a transient miss must
      // not stick tvl=0 for the whole day.
      if (result.priceSource === 'priceservice') await cache.set(key, result, PAST_DAY_CACHE_TTL_MS)
      else await cache.set(key, { type: 'price-service-negative', priceSource: result.priceSource }, PAST_DAY_NEGATIVE_CACHE_TTL_MS)
      return result
    }
  }

  return cache.wrap(
    blockCacheKey,
    async () => __fetchErc20PriceUsd(chainId, token, blockNumber!, latest),
    blockCacheTtl()
  )
}

// Misses keep the short negative ttl so a transient outage can't stick tvl=0 for 15 minutes.
function blockCacheTtl() {
  if (!usePriceService()) return BLOCK_CACHE_TTL_MS
  return (result: { priceSource: string }) => result.priceSource === 'priceservice'
    ? SERVICE_BLOCK_CACHE_TTL_MS
    : PAST_DAY_NEGATIVE_CACHE_TTL_MS
}

async function __fetchErc20PriceUsd(
  chainId: number,
  token: `0x${string}`,
  blockNumber: bigint,
  latest = false,
  knownBlockTime?: bigint
) {
  // USE_PRICE_SERVICE=true: price service is the only source — no table read/write,
  // no fallbacks. Unknown price when the service has nothing.
  if (usePriceService()) {
    const result = await fetchPriceServiceUsdResult(chainId, token, blockNumber, knownBlockTime)
    if (result.type === 'price') return result.price
    if (result.type === 'missing') return unknownPrice(chainId, token, blockNumber)
    return unavailablePrice(chainId, token, blockNumber, knownBlockTime)
  }
  return __fetchErc20PriceUsdFromTable(chainId, token, blockNumber, latest)
}

/** Legacy path: read/write the Postgres price table (USE_PRICE_SERVICE=false, default). */
async function __fetchErc20PriceUsdFromTable(chainId: number, token: `0x${string}`, blockNumber: bigint, latest = false) {
  let result: Price | undefined

  if (latest) {
    result = await fetchYDaemonPriceUsd(chainId, token, blockNumber)
    if (result) {
      await mq.add(mq.job.load.price, result)
      return result
    }
  }

  result = await fetchDbPriceUsd(chainId, token, blockNumber)
  if (result) return result

  result = await fetchLensPriceUsd(chainId, token, blockNumber)
  if (result) {
    await mq.add(mq.job.load.price, result)
    return result
  }

  if (JSON.parse(process.env.YPRICE_ENABLED || 'false')) {
    result = await fetchYPriceUsd(chainId, token, blockNumber)
    if (result) {
      await mq.add(mq.job.load.price, result)
      return result
    }
  }

  result = await fetchPriceServiceUsd(chainId, token, blockNumber)
  if (result) {
    await mq.add(mq.job.load.price, result)
    return result
  }

  console.warn('🚨', 'no price', chainId, token, blockNumber)
  const empty = await unknownPrice(chainId, token, blockNumber)
  await mq.add(mq.job.load.price, empty)
  return empty
}

async function unknownPrice(chainId: number, token: `0x${string}`, blockNumber: bigint): Promise<Price> {
  return {
    chainId,
    address: token,
    priceUsd: 0,
    priceSource: 'na',
    blockNumber,
    blockTime: await getBlockTime(chainId, blockNumber)
  }
}

async function unavailablePrice(chainId: number, token: `0x${string}`, blockNumber: bigint, knownBlockTime?: bigint): Promise<Price> {
  return {
    chainId,
    address: token,
    priceUsd: 0,
    priceSource: 'unavailable',
    blockNumber,
    blockTime: knownBlockTime ?? await getBlockTime(chainId, blockNumber)
  }
}

/** Must match price-service CHAIN_ID_TO_NAME (gnosis, not xdai). */
export const PRICE_SERVICE_CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum', 10: 'optimism', 100: 'gnosis', 137: 'polygon',
  146: 'sonic', 250: 'fantom', 8453: 'base', 42161: 'arbitrum',
  80094: 'berachain', 747474: 'katana',
}

const PRICE_SERVICE_DEFAULT_URL = 'https://prices.yearn.dev'

type PriceServiceResult =
  | { type: 'price', price: Price }
  | { type: 'missing' }
  | { type: 'unavailable' }

type PriceServiceNegativeCacheMarker = {
  type: 'price-service-negative'
  priceSource: string
}

function isPriceServiceNegativeCacheMarker(value: unknown): value is PriceServiceNegativeCacheMarker {
  return typeof value === 'object' && value !== null
    && (value as PriceServiceNegativeCacheMarker).type === 'price-service-negative'
    && ['na', 'unavailable'].includes((value as PriceServiceNegativeCacheMarker).priceSource)
}

async function fetchPriceServiceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint, knownBlockTime?: bigint): Promise<Price | undefined> {
  const result = await fetchPriceServiceUsdResult(chainId, token, blockNumber, knownBlockTime)
  return result.type === 'price' ? result.price : undefined
}

async function fetchPriceServiceUsdResult(chainId: number, token: `0x${string}`, blockNumber: bigint, knownBlockTime?: bigint): Promise<PriceServiceResult> {
  // Warn only in service mode: in the legacy path a missing key or unmapped chain is normal.
  const warn = (reason: string, detail?: unknown) => {
    if (usePriceService()) console.warn('🚨', 'price service miss', reason, chainId, token, blockNumber, detail ?? '')
  }

  if (!process.env.PRICE_SERVICE_API_KEY) { warn('no api key'); return { type: 'unavailable' } }
  const chainName = PRICE_SERVICE_CHAIN_NAMES[chainId]
  if (!chainName) { warn('unmapped chain'); return { type: 'unavailable' } }

  const baseUrl = process.env.PRICE_SERVICE_URL || PRICE_SERVICE_DEFAULT_URL

  try {
    const blockTime = knownBlockTime ?? await getBlockTime(chainId, blockNumber)
    const coinId = `${chainName}:${token.toLowerCase()}`

    // Batching is service-mode only: the legacy path hits this as a rare last resort, where a
    // flush window buys nothing and the kill switch should take the whole layer with it.
    const batched = usePriceService()
      ? await enqueuePriceServiceBatch(coinId, Number(blockTime))
      : { found: false } as const
    if (batched.found) {
      const priceUsd = batched.priceUsd
      // A stored zero is an answer, not a gap: the exact endpoint would read the same row.
      if (!priceUsd || !Number.isFinite(priceUsd)) { warn('empty coins'); return { type: 'missing' } }
      return { type: 'price', price: PriceSchema.parse({ chainId, address: token, priceUsd, priceSource: 'priceservice', blockNumber, blockTime }) }
    }

    // batchHistorical reads the table only; the exact route also resolves upstream on a table miss.
    return await fetchPriceServiceExactResult({ chainId, token, blockNumber, blockTime, coinId, baseUrl, warn })
  } catch (error) {
    console.warn('🚨', 'price service failed', chainId, token, blockNumber, error)
    return { type: 'unavailable' }
  }
}

async function fetchPriceServiceExactResult(request: {
  chainId: number
  token: `0x${string}`
  blockNumber: bigint
  blockTime: bigint
  coinId: string
  baseUrl: string
  warn: (reason: string, detail?: unknown) => void
}): Promise<PriceServiceResult> {
  const { chainId, token, blockNumber, blockTime, coinId, baseUrl, warn } = request
  const url = `${baseUrl}/api/prices/historical/${Number(blockTime)}/${coinId}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.PRICE_SERVICE_API_KEY}` }
  })
  if (!response.ok) {
    warn('http', response.status)
    return response.status === 404 ? { type: 'missing' } : { type: 'unavailable' }
  }

  const data = await response.json() as { coins: Record<string, { price: number }> }
  const coinData = data.coins[coinId]
  const priceUsd = coinData?.price
  if (!priceUsd || !Number.isFinite(priceUsd)) { warn('empty coins'); return { type: 'missing' } }

  return { type: 'price', price: PriceSchema.parse({ chainId, address: token, priceUsd, priceSource: 'priceservice', blockNumber, blockTime }) }
}

type PriceServiceBatchOutcome = { found: true, priceUsd: number } | { found: false }

type PriceServiceBatchEntry = {
  coinId: string
  timestamp: number
  promise: Promise<PriceServiceBatchOutcome>
  resolve: (outcome: PriceServiceBatchOutcome) => void
}

const BATCH_FLUSH_MS = 25
// Capping queued entries also caps distinct coins and per-coin timestamps, the service's two limits.
const BATCH_MAX_ENTRIES = 50

const pendingBatch = new Map<string, PriceServiceBatchEntry>()
let batchTimer: ReturnType<typeof setTimeout> | undefined

function enqueuePriceServiceBatch(coinId: string, timestamp: number): Promise<PriceServiceBatchOutcome> {
  const key = `${coinId}:${utcDayStart(timestamp)}`
  const queued = pendingBatch.get(key)
  if (queued) return queued.promise

  let resolve!: (outcome: PriceServiceBatchOutcome) => void
  const promise = new Promise<PriceServiceBatchOutcome>(_resolve => { resolve = _resolve })
  pendingBatch.set(key, { coinId, timestamp, promise, resolve })

  if (pendingBatch.size >= BATCH_MAX_ENTRIES) flushPriceServiceBatch()
  else if (!batchTimer) batchTimer = setTimeout(flushPriceServiceBatch, BATCH_FLUSH_MS)

  return promise
}

function flushPriceServiceBatch() {
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = undefined }
  const entries = [...pendingBatch.values()]
  pendingBatch.clear()
  for (let i = 0; i < entries.length; i += BATCH_MAX_ENTRIES) {
    void sendPriceServiceBatch(entries.slice(i, i + BATCH_MAX_ENTRIES))
  }
}

// Never throws: an unresolved entry falls through to the exact endpoint, same as a table miss.
async function sendPriceServiceBatch(entries: PriceServiceBatchEntry[]) {
  try {
    const coins: Record<string, number[]> = {}
    for (const entry of entries) (coins[entry.coinId] ??= []).push(entry.timestamp)

    const baseUrl = process.env.PRICE_SERVICE_URL || PRICE_SERVICE_DEFAULT_URL
    const url = `${baseUrl}/api/prices/batchHistorical?coins=${encodeURIComponent(JSON.stringify(coins))}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.PRICE_SERVICE_API_KEY}` }
    })
    if (!response.ok) throw new Error(`batchHistorical ${response.status} ${url}`)

    const data = await response.json() as { coins?: Record<string, { prices?: { timestamp: number, price: number }[] }> }
    // The service echoes the key it parsed, which checksums the address.
    const byCoin = new Map(Object.entries(data.coins ?? {}).map(([key, value]) => [key.toLowerCase(), value]))

    for (const entry of entries) {
      const day = utcDayStart(entry.timestamp)
      const hit = byCoin.get(entry.coinId)?.prices?.find(price => utcDayStart(price.timestamp) === day)
      entry.resolve(hit ? { found: true, priceUsd: hit.price } : { found: false })
    }
  } catch (error) {
    // Distinguish a broken batch route from a legitimate table miss, which resolves the same way.
    console.warn('🚨', 'price service batch failed', entries.length, error)
    for (const entry of entries) entry.resolve({ found: false })
  }
}

async function fetchYPriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  if (!process.env.YPRICE_API) return undefined

  try {
    const url = `${process.env.YPRICE_API}/get_price/${chainId}/${token}?block=${blockNumber}`
    const result = await fetch(url, {
      headers: {
        'X-Signature': process.env.YPRICE_API_X_SIGNATURE || '',
        'X-Signer': process.env.YPRICE_API_X_SIGNER || ''
      }
    })

    const priceUsd = Number(await result.json())
    if (priceUsd === 0) return undefined

    return PriceSchema.parse({
      chainId,
      address: token,
      priceUsd,
      priceSource: 'lens',
      blockNumber,
      blockTime: await getBlockTime(chainId, blockNumber)
    })

  } catch {
    console.warn('🚨', 'yprice failed', chainId, token, blockNumber)
    return undefined
  }
}

async function fetchDbPriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  const result = await db.query(
    `SELECT
      chain_id as "chainId",
      address,
      price_usd as "priceUsd",
      price_source as "priceSource",
      block_number as "blockNumber",
      block_time as "blockTime"
    FROM price WHERE chain_id = $1 AND address = $2 AND block_number = $3`,
    [chainId, getAddress(token), blockNumber]
  )
  if (result.rows.length === 0) return undefined
  return PriceSchema.parse(result.rows[0])
}

async function fetchLensPriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  if (!(chainId in lens)) return undefined

  try {
    const priceUSDC = await rpcs.next(chainId, blockNumber).readContract({
      address: lens[chainId as keyof typeof lens],
      functionName: 'getPriceUsdcRecommended',
      args: [token],
      abi: parseAbi(['function getPriceUsdcRecommended(address tokenAddress) view returns (uint256)']),
      blockNumber
    }) as bigint

    if (priceUSDC === 0n) return undefined

    return PriceSchema.parse({
      chainId,
      address: token,
      priceUsd: Number(priceUSDC * 10_000n / BigInt(10 ** 6)) / 10_000,
      priceSource: 'lens',
      blockNumber,
      blockTime: await getBlockTime(chainId, blockNumber)
    })

  } catch (error) {
    console.warn('🚨', 'lens price failed', error)
    return undefined
  }
}

async function fetchAllYDaemonPrices() {
  if (!process.env.YDAEMON_API) throw new Error('!YDAEMON_API')
  return cache.wrap('fetchAllYDaemonPrices', async () => {
    const url = `${process.env.YDAEMON_API}/prices/all?humanized=true`
    const result = await fetch(url)
    const json = await result.json()
    return lowercaseAddresses(json)
  }, 60_000)
}

type YDaemonPrices = {
  [key: string]: {
      [key: string]: number
  }
}

function lowercaseAddresses(data: YDaemonPrices): YDaemonPrices {
  const result: YDaemonPrices = {}
  for (const outerKey in data) {
    result[outerKey] = {}
    for (const innerKey in data[outerKey]) {
      result[outerKey][innerKey.toLowerCase()] = data[outerKey][innerKey]
    }
  }
  return result
}

async function fetchYDaemonPriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  try {
    const prices = await fetchAllYDaemonPrices()
    const price = prices[chainId.toString()]?.[token.toLowerCase()] || 0
    if (isNaN(price)) return undefined
    return PriceSchema.parse({
      chainId,
      address: token,
      priceUsd: price,
      priceSource: 'ydaemon',
      blockNumber,
      blockTime: await getBlockTime(chainId, blockNumber)
    })
  } catch (error) {
    console.warn('🚨', 'ydaemon price failed', error)
    return undefined
  }
}
