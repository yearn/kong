import { createKeyv } from '@keyv/redis'
import { createClient } from '@redis/client'
import { delegate, perRequest } from '../request-scope'
import { restHistoryStart } from './history'

const currentWriteClient = perRequest(() => {
  const client = createClient({ url: process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379' })
  client.on('error', (error) => console.error('rest cache write client', error))
  return client
})

export const writeClient = delegate(currentWriteClient)

const keyv = delegate(perRequest(() => createKeyv(process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379')))

const DEFAULT_REDIS_MSET_TARGET_BYTES = 8 * 1024 * 1024
const REDIS_MSET_HARD_LIMIT_BYTES = 10 * 1024 * 1024
const REDIS_GET_CONCURRENCY = 5
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

// Keep the cutoff outside the public value so older readers can use the same keys.
export function serializeState(value: unknown, cutoff: number): string {
  return JSON.stringify({ value, cutoff })
}

export async function getCurrentState<T>(key: string, read: () => Promise<T | undefined>): Promise<T | undefined> {
  const entry = await keyv.getRaw<T>(key) as { value: T, cutoff?: number } | undefined
  if (!entry) return undefined
  if (entry.cutoff === restHistoryStart()) return entry.value
  // A legacy entry or yesterday's publication may include expired inputs. Use a
  // scoped read until the scheduled publisher replaces it, including after a failed refresh.
  return read()
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

const writeConnections = new WeakMap<object, Promise<unknown>>()

async function connectWriteClient(): Promise<void> {
  const client = currentWriteClient()
  const pending = writeConnections.get(client)
  if (pending) { await pending; return }
  if (writeClient.isOpen) return
  const connection = writeClient.connect()
  writeConnections.set(client, connection)
  try { await connection } finally { writeConnections.delete(client) }
}

export async function cacheMGet(keys: string[]): Promise<Array<string | null>> {
  if (keys.length === 0) return []
  await connectWriteClient()
  // Upstash also limits the combined response to MGET. Read histories separately
  // so their total size cannot exceed the limit for a single command.
  const values: Array<string | null> = []
  for (let i = 0; i < keys.length; i += REDIS_GET_CONCURRENCY) {
    const results = await Promise.allSettled(
      keys.slice(i, i + REDIS_GET_CONCURRENCY).map(key => writeClient.get(key)),
    )
    // Settle all in-flight reads before returning an error to the refresh job.
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      values.push(result.value)
    }
  }
  return values
}

export async function cacheMSet(pairs: Array<[string, string]>, options: { atomic?: boolean } = {}): Promise<void> {
  if (pairs.length === 0) return
  if (options.atomic && estimateMSetRequestSize(pairs) > REDIS_MSET_HARD_LIMIT_BYTES) {
    throw new Error('Atomic Redis MSET payload exceeds hard limit')
  }
  const chunks = options.atomic ? [pairs] : splitPairsForMSet(pairs)
  await connectWriteClient()

  for (const chunk of chunks) {
    await writeClient.mSet(chunk)
  }
}

export async function disconnect(): Promise<void> {
  await writeClient.disconnect()
  await keyv.disconnect()
}

export async function cacheDelete(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await connectWriteClient()
  await writeClient.del(keys)
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
