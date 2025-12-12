import { createKeyv } from '@keyv/redis'

export function createTimeseriesKeyv() {
  const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
  return createKeyv(redisUrl)
}

export function getTimeseriesKey(
  label: string,
  chainId: number,
  addressLower: string,
): string {
  return `timeseries:${label}:${chainId}:${addressLower.toLowerCase()}`
}
