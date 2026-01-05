import { createKeyv } from '@keyv/redis'

export function createSnapshotKeyv() {
  const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
  return createKeyv(redisUrl)
}

export function getSnapshotKey(
  chainId: number,
  address: string,
): string {
  return `snapshot:${chainId}:${address.toLowerCase()}`
}
