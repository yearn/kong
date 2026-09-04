import { expect } from 'chai'
import { PRICE_SERVICE_CHAIN_NAMES, assertPriceSourceConfig, usePriceService } from './prices'

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

  it('accepts true in any case', () => {
    process.env.USE_PRICE_SERVICE = 'TRUE'
    expect(usePriceService()).to.equal(true)
  })

  it('treats non-true values as false', () => {
    process.env.USE_PRICE_SERVICE = '1'
    expect(usePriceService()).to.equal(false)
  })

  it('rejects service mode without an api key', () => {
    process.env.USE_PRICE_SERVICE = 'true'
    delete process.env.PRICE_SERVICE_API_KEY
    expect(() => assertPriceSourceConfig()).to.throw('PRICE_SERVICE_API_KEY')
  })

  it('accepts table mode without an api key', () => {
    delete process.env.USE_PRICE_SERVICE
    delete process.env.PRICE_SERVICE_API_KEY
    expect(() => assertPriceSourceConfig()).to.not.throw()
  })

  it('maps chain 100 to gnosis (not xdai)', () => {
    expect(PRICE_SERVICE_CHAIN_NAMES[100]).to.equal('gnosis')
  })
})
