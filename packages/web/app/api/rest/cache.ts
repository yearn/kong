import { createKeyv } from '@keyv/redis'

export const keyv = createKeyv(process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379')
