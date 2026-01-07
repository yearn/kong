import { createKeyv } from '@keyv/redis'
import { createClient } from 'redis'

export function createListsKeyv() {
  const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
  return createKeyv(redisUrl)
}

export function getListKey(label: string, chainId?: number): string {
  if (chainId !== undefined) {
    return `list:${label}:${chainId}`
  }
  return `list:${label}`
}

export async function createRedisClient() {
  const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
  const client = createClient({ url: redisUrl })
  await client.connect()
  return client
}
