import { createKeyv } from '@keyv/redis'

/**
 * Create Redis client for snapshot cache
 * Uses REST_CACHE_REDIS_URL environment variable
 */
export function createSnapshotKeyv() {
  const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
  return createKeyv(redisUrl)
}

/**
 * Generate Redis cache key for vault snapshot
 * Format: snapshot:{chainId}:{addressLower}
 *
 * @param chainId - Chain ID
 * @param addressLower - Lowercase vault address
 * @returns Redis cache key
 */
export function getSnapshotKey(
  chainId: number,
  addressLower: string
): string {
  return `snapshot:${chainId}:${addressLower.toLowerCase()}`
}
