import { expect } from 'chai'
import {
  isCurrentUtcDay,
  PRICE_SERVICE_CHAIN_NAMES,
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

  it('maps chain 100 to gnosis (not xdai)', () => {
    expect(PRICE_SERVICE_CHAIN_NAMES[100]).to.equal('gnosis')
  })
})
