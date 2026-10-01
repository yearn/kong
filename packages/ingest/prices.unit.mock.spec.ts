import { expect } from 'chai'
import { PRICE_SERVICE_CHAIN_NAMES, assertPriceSourceConfig } from './prices'

describe('prices helpers', () => {
  const originalApiKey = process.env.PRICE_SERVICE_API_KEY

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.PRICE_SERVICE_API_KEY
    else process.env.PRICE_SERVICE_API_KEY = originalApiKey
  })

  it('rejects startup without an api key', () => {
    delete process.env.PRICE_SERVICE_API_KEY
    expect(() => assertPriceSourceConfig()).to.throw('PRICE_SERVICE_API_KEY')
  })

  it('accepts startup with an api key', () => {
    process.env.PRICE_SERVICE_API_KEY = 'test-key'
    expect(() => assertPriceSourceConfig()).to.not.throw()
  })

  it('maps chain 100 to gnosis (not xdai)', () => {
    expect(PRICE_SERVICE_CHAIN_NAMES[100]).to.equal('gnosis')
  })
})
