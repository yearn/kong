import { cache } from 'lib/cache'
import { latestBlocks } from './rpcs'

const HISTORICAL_AGE_SECONDS = 24n * 60n * 60n
const HISTORICAL_TTL_MS = 24 * 60 * 60 * 1000
const NEAR_HEAD_TTL_MS = 15 * 1000
const UNKNOWN_AGE_TTL_MS = 1000
const MAX_HEAD_AGE_MS = 60_000

function ttlForObservation(
  chainId: number,
  blockNumber: bigint,
  blockTime?: bigint,
  isHistorical?: boolean
) {
  if (isHistorical === true) return HISTORICAL_TTL_MS
  if (isHistorical === false) return NEAR_HEAD_TTL_MS
  if (blockTime === undefined) return UNKNOWN_AGE_TTL_MS

  const now = BigInt(Math.floor(Date.now() / 1000))
  if (blockTime > now - HISTORICAL_AGE_SECONDS) return NEAR_HEAD_TTL_MS

  const head = latestBlocks[chainId]
  if (head && Date.now() - head.observedAt <= MAX_HEAD_AGE_MS) {
    // A timestamp supplied by a stale or approximate observation cannot make a
    // block near the current head look historical. The fresh block poller is
    // authoritative when available; the timestamp path also supports offline
    // backfills where no poller has populated latestBlocks.
    if (blockNumber + 1n >= head.blockNumber) return NEAR_HEAD_TTL_MS
    if (blockTime >= head.blockTime - HISTORICAL_AGE_SECONDS) return NEAR_HEAD_TTL_MS
  }

  return HISTORICAL_TTL_MS
}

/** Cache a successful, unwrapped PPS observation as a decimal string. */
export async function cachePps(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  cacheInput: string,
  read: () => Promise<bigint>,
  options: { blockTime?: bigint, isHistorical?: boolean } = {}
): Promise<bigint> {
  const key = `pps:v1:${chainId}:${address.toLowerCase()}:${blockNumber}:${cacheInput}`
  const value = await cache.wrap(key, async () => String(await read()),
    ttlForObservation(chainId, blockNumber, options.blockTime, options.isHistorical))
  return BigInt(value)
}
