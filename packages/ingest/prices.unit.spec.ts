import { expect } from 'chai'
import {
  assertPriceSourceConfig,
  isCurrentUtcDay,
  PRICE_SERVICE_CHAIN_NAMES,
  priceServiceMetrics,
  usePriceService,
  utcDayStart
} from './prices'

describe('prices helpers', () => {
  const originalUsePriceService = process.env.USE_PRICE_SERVICE
  const originalApiKey = process.env.PRICE_SERVICE_API_KEY

  afterEach(() => {
    if (originalUsePriceService === undefined) delete process.env.USE_PRICE_SERVICE
    else process.env.USE_PRICE_SERVICE = originalUsePriceService
    if (originalApiKey === undefined) delete process.env.PRICE_SERVICE_API_KEY
    else process.env.PRICE_SERVICE_API_KEY = originalApiKey
  })

  it('defaults USE_PRICE_SERVICE to false', () => {
    delete process.env.USE_PRICE_SERVICE
    expect(usePriceService()).to.equal(false)
  })

  it('accepts true', () => {
    process.env.USE_PRICE_SERVICE = 'true'
    expect(usePriceService()).to.equal(true)
  })

  it('assertPriceSourceConfig fails closed without API key when enabled', () => {
    process.env.USE_PRICE_SERVICE = 'true'
    delete process.env.PRICE_SERVICE_API_KEY
    expect(() => assertPriceSourceConfig()).to.throw(/PRICE_SERVICE_API_KEY/)
  })

  it('assertPriceSourceConfig allows disabled mode without API key', () => {
    process.env.USE_PRICE_SERVICE = 'false'
    delete process.env.PRICE_SERVICE_API_KEY
    expect(() => assertPriceSourceConfig()).to.not.throw()
  })

  it('assertPriceSourceConfig allows enabled mode with API key', () => {
    process.env.USE_PRICE_SERVICE = 'true'
    process.env.PRICE_SERVICE_API_KEY = 'test-key'
    expect(() => assertPriceSourceConfig()).to.not.throw()
  })

  it('utcDayStart floors to UTC midnight', () => {
    // 2024-06-15 12:00:00 UTC
    const noon = 1_718_452_800
    expect(utcDayStart(noon)).to.equal(1_718_409_600)
    expect(utcDayStart(BigInt(noon))).to.equal(1_718_409_600)
  })

  it('isCurrentUtcDay matches only the same UTC day', () => {
    const now = 1_718_452_800 // 2024-06-15 12:00 UTC
    expect(isCurrentUtcDay(now, now)).to.equal(true)
    expect(isCurrentUtcDay(now - 86_400, now)).to.equal(false)
    expect(isCurrentUtcDay(now + 86_400, now)).to.equal(false)
  })

  it('priceServiceMetrics can reset', () => {
    priceServiceMetrics.requests = 3
    priceServiceMetrics.hits = 2
    priceServiceMetrics.reset()
    expect(priceServiceMetrics.requests).to.equal(0)
    expect(priceServiceMetrics.hits).to.equal(0)
  })

  it('maps chain 100 to gnosis (not xdai)', () => {
    expect(PRICE_SERVICE_CHAIN_NAMES[100]).to.equal('gnosis')
  })
})
