import { createKeyv } from '@keyv/redis'

const keyv = createKeyv(process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379')

export function createKeyvClient() {
  return keyv
}

/**
 * Batch write using Redis MSET (1 command) instead of Keyv's
 * setMany which uses MULTI + N SETs + EXEC (N+2 commands).
 */
export async function cacheMSet(pairs: Array<[string, string]>): Promise<void> {
  if (pairs.length === 0) return
  const store = keyv.store as { client: { mSet: (pairs: Array<[string, string]>, options?: unknown) => Promise<unknown>; isOpen: boolean; connect: () => Promise<unknown> } }
  const client = store.client
  if (!client.isOpen) await client.connect()
  await client.mSet(pairs)
}

export async function disconnect(): Promise<void> {
  await keyv.disconnect()
}
