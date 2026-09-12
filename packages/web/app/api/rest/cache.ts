import { createKeyv } from '@keyv/redis'
import { createClient } from '@redis/client'

export const writeClient = createClient({ url: process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379' })

writeClient.on('error', (error) => console.error('rest cache write client', error))

const keyv = createKeyv(process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379')

const DEFAULT_REDIS_MSET_TARGET_BYTES = 8 * 1024 * 1024
const REDIS_MSET_HARD_LIMIT_BYTES = 10 * 1024 * 1024
const parsedRedisMSetTargetBytes = parseInt(
  process.env.REST_CACHE_REDIS_MAX_REQUEST_BYTES || `${DEFAULT_REDIS_MSET_TARGET_BYTES}`,
  10,
)
const REDIS_MSET_TARGET_BYTES = Number.isFinite(parsedRedisMSetTargetBytes) && parsedRedisMSetTargetBytes > 0
  ? Math.min(parsedRedisMSetTargetBytes, REDIS_MSET_HARD_LIMIT_BYTES)
  : DEFAULT_REDIS_MSET_TARGET_BYTES

export function getKeyvClient() {
  return keyv
}

/**
 * Batch write using Redis MSET (1 command) instead of Keyv's
 * setMany which uses MULTI + N SETs + EXEC (N+2 commands).
 */

function getRespBulkStringSize(value: string): number {
  const bytes = Buffer.byteLength(value)
  return bytes + String(bytes).length + 5
}

function getRespArrayHeaderSize(itemCount: number): number {
  return String(itemCount).length + 3
}

export function estimateMSetRequestSize(pairs: Array<[string, string]>): number {
  const itemCount = 1 + (pairs.length * 2)
  return pairs.reduce((size, [key, value]) => (
    size + getRespBulkStringSize(key) + getRespBulkStringSize(value)
  ), getRespArrayHeaderSize(itemCount) + getRespBulkStringSize('MSET'))
}

export function splitPairsForMSet(
  pairs: Array<[string, string]>,
  targetBytes = REDIS_MSET_TARGET_BYTES,
): Array<Array<[string, string]>> {
  if (pairs.length === 0) return []

  const safeTargetBytes = Math.min(targetBytes, REDIS_MSET_HARD_LIMIT_BYTES)
  const chunks: Array<Array<[string, string]>> = []
  let currentChunk: Array<[string, string]> = []

  for (const pair of pairs) {
    const pairSize = estimateMSetRequestSize([pair])
    if (pairSize > REDIS_MSET_HARD_LIMIT_BYTES) {
      throw new Error(`Redis MSET payload exceeds hard limit for key "${pair[0]}" (${pairSize} bytes)`)
    }

    const nextChunk = [...currentChunk, pair]
    const nextSize = estimateMSetRequestSize(nextChunk)

    if (currentChunk.length > 0 && nextSize > safeTargetBytes) {
      chunks.push(currentChunk)
      currentChunk = [pair]
      continue
    }

    currentChunk = nextChunk
  }

  if (currentChunk.length > 0) chunks.push(currentChunk)

  return chunks
}

export async function cacheMSet(pairs: Array<[string, string]>): Promise<void> {
  if (pairs.length === 0) return
  if (!writeClient.isOpen) await writeClient.connect()

  for (const chunk of splitPairsForMSet(pairs)) {
    await writeClient.mSet(chunk)
  }
}

export async function disconnect(): Promise<void> {
  await writeClient.disconnect()
  await keyv.disconnect()
}

const LAST_REFRESH_PREFIX = 'rest:refresh:'

export async function setLastRefresh(job: string, at = new Date()): Promise<void> {
  await keyv.set(`${LAST_REFRESH_PREFIX}${job}`, at.toISOString())
}

export async function getLastRefresh(job: string): Promise<string | undefined> {
  return await keyv.get(`${LAST_REFRESH_PREFIX}${job}`) as string | undefined
}

export async function lastRefreshHeaders(job: string): Promise<Record<string, string>> {
  try {
    const at = await getLastRefresh(job)
    if (!at) return {}
    return {
      'x-last-refresh': at,
      'access-control-expose-headers': 'x-last-refresh',
    }
  } catch (err) {
    console.error(`last refresh read failed for ${job}:`, err)
    return {}
  }
}
