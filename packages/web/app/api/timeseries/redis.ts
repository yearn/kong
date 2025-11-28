import Keyv from 'keyv'
import KeyvRedis from '@keyv/redis'

export function createTimeseriesKeyv(store?: Keyv<any>['opts']['store']): Keyv {
  if (store) {
    return new Keyv({ store })
  }

  const redisUrl = process.env.GQL_CACHE_REDIS_URL
  if (redisUrl) {
    return new Keyv({ store: new KeyvRedis(redisUrl) })
  }

  return new Keyv()
}

export function getTimeseriesKey(
  label: string,
  chainId: number,
  addressLower: string,
): string {
  return `timeseries:${label}:${chainId}:${addressLower.toLowerCase()}`
}
