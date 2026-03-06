import { createKeyv } from '@keyv/redis'

export function createKeyvClient() {
  const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
  return createKeyv(redisUrl)
}

