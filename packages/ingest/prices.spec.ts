import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import { fetchErc20PriceUsd } from './prices'

const block = 18166519n
const ypriceEnabled = JSON.parse(process.env.YPRICE_ENABLED || 'false')

describe('prices', () => {
  it('returns ydaemon price for latest WETH', async () => {
    const doesntMatterWhichBlock = 13n
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', doesntMatterWhichBlock, true)
    expect(priceSource).to.equal('ydaemon')
    expect(priceUsd).to.be.greaterThan(0)
  }, 120_000)

  it('returns lens price for historic WETH', async () => {
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', block)
    expect(priceSource).to.equal('lens')
    expect(priceUsd).to.be.greaterThan(0)
  }, 120_000)

  it.skipIf(!ypriceEnabled)('returns yprice for yvCurve-clevCVX-f-f', async () => {
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xc869206adAfD3D874dB22e8BbA662E05F6257613', block)
    expect(priceSource).to.equal('yprice')
    expect(priceUsd).to.be.greaterThan(0)
  }, 120_000)

  it.skipIf(!ypriceEnabled)('returns yprice for crvGEARETH-f', async () => {
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0x5Be6C45e2d074fAa20700C49aDA3E88a1cc0025d', block)
    expect(priceSource).to.equal('yprice')
    expect(priceUsd).to.be.greaterThan(0)
  }, 120_000)

  it.skipIf(!process.env.PRICE_SERVICE_API_KEY)('returns priceservice for historic BOLD', async () => {
    // BOLD (Liquity v2) is not supported by Lens, so it falls through to price service
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0x6440f144b7e50D6a8439336510312d2F54beB01D', 25035087n)
    expect(priceUsd).to.be.greaterThan(0)
    expect(priceSource).to.equal('priceservice')
  }, 120_000)
})
