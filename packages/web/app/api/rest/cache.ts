import { createKeyv } from '@keyv/redis'
import { createClient } from '@redis/client'

const writeClient = createClient({ url: process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379' })

const keyv = createKeyv(process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379')

export function getKeyvClient() {
  return keyv
}

/**
 * Batch write using Redis MSET (1 command) instead of Keyv's
 * setMany which uses MULTI + N SETs + EXEC (N+2 commands).
 */

export async function cacheMSet(pairs: Array<[string, string]>): Promise<void> {
  if (pairs.length === 0) return
  if (!writeClient.isOpen) await writeClient.connect()
  await writeClient.mSet(pairs)
}

export async function disconnect(): Promise<void> {
  await writeClient.disconnect()
  await keyv.disconnect()
}
