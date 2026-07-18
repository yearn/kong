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
const LATEST_CACHE_TTL_MS = 30_000

/** Trial metrics for USE_PRICE_SERVICE HTTP lookups (by chain / outcome). */
export const priceServiceMetrics = {
  requests: 0,
  hits: 0,
  misses: 0,
  errors: 0,
  byChain: {} as Record<number, number>,
  reset() {
    this.requests = 0
    this.hits = 0
    this.misses = 0
    this.errors = 0
    this.byChain = {}
  }
}

/**
 * When true, indexer reads prices from yearn-prices and skips the Postgres price table.
 * Service mode is not strictly service-only: it keeps the §5 fallback policy
 * (past-day: service→lens→yprice; current-day: yDaemon→spot→lens) so a single
 * service miss doesn't materialize tvl=0. Don't "simplify" this to service-only.
 */
export function usePriceService(): boolean {
  return JSON.parse(process.env.USE_PRICE_SERVICE || 'false')
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

function recordServiceOutcome(chainId: number, token: string, day: number, outcome: 'hit' | 'miss' | 'error') {
  priceServiceMetrics.requests++
  priceServiceMetrics.byChain[chainId] = (priceServiceMetrics.byChain[chainId] || 0) + 1
  if (outcome === 'hit') priceServiceMetrics.hits++
  else if (outcome === 'miss') priceServiceMetrics.misses++
  else priceServiceMetrics.errors++
  console.info(JSON.stringify({
    event: 'price_service',
    chainId,
    token,
    day,
    outcome
  }))
}

async function maybePersistPrice(result: Price) {
  if (!usePriceService()) {
    await mq.add(mq.job.load.price, result)
  }
}

export async function fetchErc20PriceUsd(chainId: number, token: `0x${string}`, blockNumber?: bigint, latest = false): Promise<{ priceUsd: number, priceSource: string }>{
  token = getAddress(token)

  if (!blockNumber) {
    blockNumber = await getBlockNumber(chainId)
    latest = true
  }

  if (usePriceService() && !latest) {
    const blockTime = await getBlockTime(chainId, blockNumber)
    if (!isCurrentUtcDay(blockTime)) {
      const day = utcDayStart(blockTime)
      const key = `fetchErc20PriceUsd:service:${chainId}:${token}:${day}`
      const cached = await cache.get(key) as Price | undefined
      if (cached) return cached
      const result = await __fetchErc20PriceUsd(chainId, token, blockNumber, latest, blockTime)
      // Never cache an unknown: a transient service failure must not stick tvl=0 for a day (§5).
      if (result.priceSource !== 'na') await cache.set(key, result, PAST_DAY_CACHE_TTL_MS)
      return result
    }
  }

  return cache.wrap(
    `fetchErc20PriceUsd:${chainId}:${token}:${blockNumber}`,
    async () => __fetchErc20PriceUsd(chainId, token, blockNumber!, latest),
    LATEST_CACHE_TTL_MS
  )
}

async function __fetchErc20PriceUsd(
  chainId: number,
  token: `0x${string}`,
  blockNumber: bigint,
  latest = false,
  knownBlockTime?: bigint
) {
  if (usePriceService()) {
    return __fetchErc20PriceUsdFromService(chainId, token, blockNumber, latest, knownBlockTime)
  }
  return __fetchErc20PriceUsdFromTable(chainId, token, blockNumber, latest)
}

/** Legacy path: read/write the Postgres price table (USE_PRICE_SERVICE=false, default). */
async function __fetchErc20PriceUsdFromTable(chainId: number, token: `0x${string}`, blockNumber: bigint, latest = false) {
  let result: Price | undefined

  if (latest) {
    result = await fetchYDaemonPriceUsd(chainId, token, blockNumber)
    if (result) {
      await maybePersistPrice(result)
      return result
    }
  }

  result = await fetchDbPriceUsd(chainId, token, blockNumber)
  if (result) return result

  result = await fetchLensPriceUsd(chainId, token, blockNumber)
  if (result) {
    await maybePersistPrice(result)
    return result
  }

  if (JSON.parse(process.env.YPRICE_ENABLED || 'false')) {
    result = await fetchYPriceUsd(chainId, token, blockNumber)
    if (result) {
      await maybePersistPrice(result)
      return result
    }
  }

  result = await fetchPriceServiceUsd(chainId, token, blockNumber)
  if (result) {
    await maybePersistPrice(result)
    return result
  }

  console.warn('🚨', 'no price', chainId, token, blockNumber)
  const empty = await unknownPrice(chainId, token, blockNumber)
  await maybePersistPrice(empty)
  return empty
}

/**
 * Service path (USE_PRICE_SERVICE=true): no table read/write.
 * Past UTC days: price service is primary (day-granularity historical).
 * Current day / latest: yDaemon or service /spot only — never treat mid-day
 * spot as that day's historical close (and we never persist in this mode).
 */
async function __fetchErc20PriceUsdFromService(
  chainId: number,
  token: `0x${string}`,
  blockNumber: bigint,
  latest = false,
  knownBlockTime?: bigint
) {
  const blockTime = knownBlockTime ?? await getBlockTime(chainId, blockNumber)
  const useLive = latest || isCurrentUtcDay(blockTime)

  if (useLive) {
    // yDaemon returns a 0-price object (not undefined) for tokens it doesn't know;
    // treat that as a miss so the spot/lens fallbacks below actually fire.
    let live = await fetchYDaemonPriceUsd(chainId, token, blockNumber)
    if (live && live.priceUsd > 0) return live

    live = await fetchPriceServiceSpotUsd(chainId, token, blockNumber)
    if (live) return live

    // On-chain lens is block-accurate, not a mid-day close substitute for history.
    live = await fetchLensPriceUsd(chainId, token, blockNumber)
    if (live) return live

    console.warn('🚨', 'no live price', chainId, token, blockNumber)
    return unknownPrice(chainId, token, blockNumber)
  }

  // Past day: service first, then lens/yprice fallbacks. Explicit unknown if none.
  let result = await fetchPriceServiceUsd(chainId, token, blockNumber)
  if (result) return result

  result = await fetchLensPriceUsd(chainId, token, blockNumber)
  if (result) return result

  if (JSON.parse(process.env.YPRICE_ENABLED || 'false')) {
    result = await fetchYPriceUsd(chainId, token, blockNumber)
    if (result) return result
  }

  console.warn('🚨', 'no price (service mode, explicit unknown)', chainId, token, blockNumber, utcDayStart(blockTime))
  return unknownPrice(chainId, token, blockNumber)
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

/** Must match price-service CHAIN_ID_TO_NAME (gnosis, not xdai). */
export const PRICE_SERVICE_CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum', 10: 'optimism', 100: 'gnosis', 137: 'polygon',
  146: 'sonic', 250: 'fantom', 8453: 'base', 42161: 'arbitrum',
  80094: 'berachain', 747474: 'katana',
}

const PRICE_SERVICE_DEFAULT_URL = 'https://prices.yearn.dev'

async function fetchPriceServiceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  if (!process.env.PRICE_SERVICE_API_KEY) return undefined
  const chainName = PRICE_SERVICE_CHAIN_NAMES[chainId]
  if (!chainName) return undefined

  const baseUrl = process.env.PRICE_SERVICE_URL || PRICE_SERVICE_DEFAULT_URL
  const blockTime = await getBlockTime(chainId, blockNumber)
  const day = utcDayStart(blockTime)

  try {
    const coinId = `${chainName}:${token.toLowerCase()}`
    const coins = encodeURIComponent(JSON.stringify({ [coinId]: [Number(blockTime)] }))
    // No source= filter: service uses its default priority (defillama → … → enso).
    const url = `${baseUrl}/api/prices/batchHistorical?coins=${coins}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.PRICE_SERVICE_API_KEY}` }
    })
    if (!response.ok) {
      recordServiceOutcome(chainId, token, day, 'error')
      return undefined
    }

    const data = await response.json() as { coins: Record<string, { symbol: string; prices: { timestamp: number; price: number; confidence: number; source: string }[] }> }
    const coinData = data.coins[coinId]
    const priceUsd = coinData?.prices?.[0]?.price
    if (!priceUsd) {
      recordServiceOutcome(chainId, token, day, 'miss')
      return undefined
    }

    recordServiceOutcome(chainId, token, day, 'hit')
    return PriceSchema.parse({ chainId, address: token, priceUsd, priceSource: 'priceservice', blockNumber, blockTime })
  } catch {
    recordServiceOutcome(chainId, token, day, 'error')
    console.warn('🚨', 'price service failed', chainId, token, blockNumber)
    return undefined
  }
}

/** Live spot from price-service (current-day / latest only — not written as historical close). */
async function fetchPriceServiceSpotUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  if (!process.env.PRICE_SERVICE_API_KEY) return undefined
  const chainName = PRICE_SERVICE_CHAIN_NAMES[chainId]
  if (!chainName) return undefined

  const baseUrl = process.env.PRICE_SERVICE_URL || PRICE_SERVICE_DEFAULT_URL
  const day = utcDayStart(Math.floor(Date.now() / 1000))

  try {
    const coinId = `${chainName}:${token.toLowerCase()}`
    const coins = encodeURIComponent(JSON.stringify([coinId]))
    const url = `${baseUrl}/api/prices/spot?coins=${coins}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.PRICE_SERVICE_API_KEY}` }
    })
    if (!response.ok) {
      recordServiceOutcome(chainId, token, day, 'error')
      return undefined
    }

    const data = await response.json() as { coins: Record<string, { symbol: string; prices: { timestamp: number; price: number; confidence: number; source: string }[] }> }
    const priceUsd = data.coins[coinId]?.prices?.[0]?.price
    if (!priceUsd) {
      recordServiceOutcome(chainId, token, day, 'miss')
      return undefined
    }

    recordServiceOutcome(chainId, token, day, 'hit')
    return PriceSchema.parse({
      chainId,
      address: token,
      priceUsd,
      priceSource: 'priceservice-spot',
      blockNumber,
      blockTime: await getBlockTime(chainId, blockNumber)
    })
  } catch {
    recordServiceOutcome(chainId, token, day, 'error')
    console.warn('🚨', 'price service spot failed', chainId, token, blockNumber)
    return undefined
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
