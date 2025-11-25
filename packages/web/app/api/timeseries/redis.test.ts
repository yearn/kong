import assert from 'assert'
import Keyv from 'keyv'
import { createTimeseriesKeyv, getTimeseriesKey } from './redis'

describe('timeseries redis helper', function() {
  const originalRedisUrl = process.env.GQL_CACHE_REDIS_URL

  afterEach(function() {
    if (originalRedisUrl === undefined) {
      delete process.env.GQL_CACHE_REDIS_URL
    } else {
      process.env.GQL_CACHE_REDIS_URL = originalRedisUrl
    }
  })

  it('creates in-memory keyv when no redis url is configured', function() {
    delete process.env.GQL_CACHE_REDIS_URL

    const keyv = createTimeseriesKeyv()

    assert(keyv instanceof Keyv)
    assert(keyv.opts.store instanceof Map)
  })

  it('uses provided store when redis url is set (test stub)', function() {
    process.env.GQL_CACHE_REDIS_URL = 'redis://example:6379'
    const stubStore = new Map()

    const keyv = createTimeseriesKeyv(stubStore)

    assert.strictEqual(keyv.opts.store, stubStore)
  })

  it('builds normalized timeseries cache keys', function() {
    const key = getTimeseriesKey('pps', 1, '0xABCdef')
    assert.strictEqual(key, 'timeseries:pps:1:0xabcdef')
  })
})
