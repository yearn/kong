import { estimateHeightWithAge, getBlock } from 'lib/blocks'
import { cache } from 'lib/cache'
import { rpcs } from 'lib/rpcs'
import { Output, OutputSchema } from 'lib/types'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { Data } from '../../../../../../extract/timeseries'
import { computeApy, computeNetApr, extractFees__v3 } from '../../../../lib/apy'
import { projectStrategies } from '../../snapshot/hook'
import { V3_ORACLE_ABI } from './abi'
import { getOracleConfig } from './constants'

export { computeNetApr } from '../../../../lib/apy'

export const outputLabel = 'apr-oracle'

const NEGATIVE_CACHE_PREFIX = 'apr-oracle:negative:v1:'
const NEGATIVE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TRANSIENT_CACHE_TTL_MS = 30 * 1000
const TRANSIENT_CACHE_MAX_TTL_MS = 60 * 60 * 1000
const TRANSIENT_ATTEMPTS_TTL_MS = 24 * 60 * 60 * 1000
const NEGATIVE_CACHE_CLEAR_BATCH_SIZE = 100

type AprNegativeCacheMarker = {
  type: 'apr-oracle-negative'
  reason: 'contract-revert' | 'transient'
}

function parseApr(rawApr: bigint): number | undefined {
  const apr = Number(rawApr) / 1e18
  if (isNaN(apr) || !isFinite(apr)) return undefined
  return apr
}

function isContractRevert(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false
  return !!error.walk(cause => cause instanceof ContractFunctionRevertedError)
}

export async function readApr(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  oracleAddress: `0x${string}`,
): Promise<number | undefined> {
  // Public/direct reads do not assume the requested block is final. The
  // resolver below opts into negative caching only after checking its age.
  return readAprAtBlock(chainId, address, blockNumber, oracleAddress, false)
}

async function readAprAtBlock(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  oracleAddress: `0x${string}`,
  confirmedHistorical: boolean,
): Promise<number | undefined> {
  const cacheNegative = confirmedHistorical
  const key = negativeCacheKey(chainId, address, blockNumber, oracleAddress)
  const attemptsKey = `${key}:attempts`

  const cached = cacheNegative ? await getNegativeCacheValue(key) : undefined
  if (isAprNegativeCacheMarker(cached)) {
    if (cached.reason === 'transient') throw new AprOracleTransientBackoffError()
    return undefined
  }

  const rememberTransientFailure = async (error: unknown, call: string) => {
    console.warn('🚨', `apr-oracle ${call} failed`, chainId, address, String(blockNumber), error)
    if (!cacheNegative) return

    const attempts = Number(await getNegativeCacheValue(attemptsKey)) || 0
    const multiplier = 2 ** Math.min(Math.max(0, Math.floor(attempts)), 20)
    const ttl = Math.min(TRANSIENT_CACHE_TTL_MS * multiplier, TRANSIENT_CACHE_MAX_TTL_MS)
    await setNegativeCacheValue(key, { type: 'apr-oracle-negative', reason: 'transient' }, ttl)
    await setNegativeCacheValue(attemptsKey, attempts + 1, TRANSIENT_ATTEMPTS_TTL_MS)
  }

  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getStrategyApr',
      args: [address, 0n],
      blockNumber,
    })

    return parseApr(rawApr)
  } catch (error) {
    if (!isContractRevert(error)) {
      await rememberTransientFailure(error, 'getStrategyApr')
      throw error
    }
  }

  try {
    // Fallback: regular vaults without a registered strategy oracle revert on
    // getStrategyApr. getCurrentApr returns APR based on the vault's profit-unlocking rate.
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getCurrentApr',
      args: [address],
      blockNumber,
    })
    console.warn('🚨', 'apr-oracle getCurrentApr success', chainId, address, String(blockNumber), rawApr)
    return parseApr(rawApr)
  } catch (error) {
    if (isContractRevert(error)) {
      if (cacheNegative) {
        await setNegativeCacheValue(key, { type: 'apr-oracle-negative', reason: 'contract-revert' }, NEGATIVE_CACHE_TTL_MS)
        await deleteNegativeCacheValue(attemptsKey)
      }
      console.warn('🚨', 'apr-oracle getCurrentApr reverted', chainId, address, String(blockNumber))
    } else {
      await rememberTransientFailure(error, 'getCurrentApr')
      throw error
    }
    return undefined
  }
}

class AprOracleTransientBackoffError extends Error {
  constructor() {
    super('APR oracle read is in transient backoff')
    this.name = 'AprOracleTransientBackoffError'
  }
}

/**
 * Clear negative APR results before a replay so the replay can retry historic
 * blocks whose previous extraction produced no output.
 */
export async function clearNegativeAprOracleCache(): Promise<void> {
  const keys = await cache.keys(`${NEGATIVE_CACHE_PREFIX}*`)
  for (let i = 0; i < keys.length; i += NEGATIVE_CACHE_CLEAR_BATCH_SIZE) {
    await Promise.all(keys.slice(i, i + NEGATIVE_CACHE_CLEAR_BATCH_SIZE).map(key => cache.del(key)))
  }
}

function negativeCacheKey(chainId: number, address: `0x${string}`, blockNumber: bigint, oracleAddress: `0x${string}`): string {
  return `${NEGATIVE_CACHE_PREFIX}${chainId}:${address.toLowerCase()}:${oracleAddress.toLowerCase()}:${blockNumber}`
}

function isAprNegativeCacheMarker(value: unknown): value is AprNegativeCacheMarker {
  return typeof value === 'object' && value !== null
    && (value as AprNegativeCacheMarker).type === 'apr-oracle-negative'
    && ['contract-revert', 'transient'].includes((value as AprNegativeCacheMarker).reason)
}

async function getNegativeCacheValue(key: string): Promise<unknown> {
  try {
    return await cache.get(key)
  } catch (error) {
    console.warn('🚨', 'apr-oracle negative cache read failed', key, error)
    return undefined
  }
}

async function setNegativeCacheValue(key: string, value: unknown, ttl: number): Promise<void> {
  try {
    await cache.set(key, value, ttl)
  } catch (error) {
    console.warn('🚨', 'apr-oracle negative cache write failed', key, error)
  }
}

async function deleteNegativeCacheValue(key: string): Promise<void> {
  try {
    await cache.del(key)
  } catch (error) {
    console.warn('🚨', 'apr-oracle negative cache delete failed', key, error)
  }
}

// Resolve the oracle apr/apy for any vault address at a given blockTime. Shared
// with the erc4626 apr-oracle hook — the oracle prices vaults purely by address,
// so both v3 and plain erc4626 vaults go through here.
export async function resolveOracleApr(
  chainId: number,
  address: `0x${string}`,
  data: Data,
): Promise<{ apr: number, apy: number, blockNumber: bigint } | undefined> {
  const oracleConfig = getOracleConfig(chainId)
  if (!oracleConfig) return undefined

  const now = BigInt(Math.floor(Date.now() / 1000))
  const estimate = data.blockTime >= now
    ? { height: (await getBlock(chainId)).number, historical: false }
    : await estimateHeightWithAge(chainId, data.blockTime)
  const blockNumber = estimate.height

  if (blockNumber < oracleConfig.inceptBlock) return undefined

  // The current UTC day is still changing, so an unavailable oracle result
  // must not hide a later successful read during the same day. The estimate's
  // cached head comparison also protects against moving-head clamps and stalled chains.
  const historicalDay = utcDayStart(data.blockTime) < utcDayStart(now)
  const confirmedHistorical = historicalDay && estimate.historical
  const apr = await readAprAtBlock(chainId, address, blockNumber, oracleConfig.address, confirmedHistorical)
  if (apr === undefined) return undefined

  return { apr, apy: computeApy(apr), blockNumber }
}

function utcDayStart(timestamp: bigint): bigint {
  const daySeconds = 86_400n
  return timestamp / daySeconds * daySeconds
}

export default async function (
  chainId: number,
  address: `0x${string}`,
  data: Data,
): Promise<Output[]> {
  const resolved = await resolveOracleApr(chainId, address, data)
  if (!resolved) return []
  const { apr, apy, blockNumber } = resolved

  let fees = { management: 0, performance: 0 }
  try {
    const strategies = await projectStrategies(chainId, address, blockNumber)
    fees = await extractFees__v3(chainId, address, strategies, blockNumber)
  } catch (error) {
    console.warn('🚨', 'apr-oracle fee fetch failed', chainId, address, String(blockNumber), error)
  }

  const netApr = computeNetApr(apr, fees)

  const output = (component: string, value: number): Output => ({
    label: outputLabel, component, value, chainId, address, blockNumber, blockTime: data.blockTime,
  })

  return OutputSchema.array().parse([
    output('apr', apr),
    output('apy', apy),
    output('netApr', netApr),
    output('netApy', computeApy(netApr)),
  ])
}
