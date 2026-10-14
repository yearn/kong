import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import { fetchErc20PriceUsd } from './prices'

describe('prices', () => {
  it.skipIf(!process.env.PRICE_SERVICE_API_KEY)('returns priceservice for historic BOLD', async () => {
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0x6440f144b7e50D6a8439336510312d2F54beB01D', 25035087n)
    expect(priceUsd).to.be.greaterThan(0)
    expect(priceSource).to.equal('priceservice')
  }, 120_000)
})
