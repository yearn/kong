import { expect } from 'chai'
import { PRICE_SERVICE_CHAIN_NAMES, usePriceService } from './prices'

describe('prices helpers', () => {
  const originalUsePriceService = process.env.USE_PRICE_SERVICE

  afterEach(() => {
    if (originalUsePriceService === undefined) delete process.env.USE_PRICE_SERVICE
    else process.env.USE_PRICE_SERVICE = originalUsePriceService
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

  it('maps chain 100 to gnosis (not xdai)', () => {
    expect(PRICE_SERVICE_CHAIN_NAMES[100]).to.equal('gnosis')
  })
})
