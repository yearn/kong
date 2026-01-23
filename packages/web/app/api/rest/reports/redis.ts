import { createKeyv } from '@keyv/redis'

export function createReportsKeyv() {
  const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
  return createKeyv(redisUrl)
}

export function getReportKey(
  chainId: number,
): string {
  return `chain_reports:${chainId}`
}
