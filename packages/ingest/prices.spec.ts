import { describe, expect, it } from 'vitest'
import { mainnet } from 'viem/chains'
import { fetchErc20PriceUsd } from './prices'

const block = 18166519n

describe('prices', function() {
  it('returns ydaemon price for latest WETH', async function() {
    const doesntMatterWhichBlock = 13n
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', doesntMatterWhichBlock, true)
    expect(priceSource).to.equal('ydaemon')
    expect(priceUsd).to.be.greaterThan(0)
  })

  it('returns lens price for historic WETH', async function() {
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', block)
    expect(priceSource).to.equal('lens')
    expect(priceUsd).to.be.greaterThan(0)
  })

  it.skipIf(!JSON.parse(process.env.YPRICE_ENABLED || 'false'))('returns yprice for yvCurve-clevCVX-f-f', async function() {
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xc869206adAfD3D874dB22e8BbA662E05F6257613', block)
    expect(priceSource).to.equal('yprice')
    expect(priceUsd).to.be.greaterThan(0)
  })

  it.skipIf(!JSON.parse(process.env.YPRICE_ENABLED || 'false'))('returns yprice for crvGEARETH-f', async function() {
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0x5Be6C45e2d074fAa20700C49aDA3E88a1cc0025d', block)
    expect(priceSource).to.equal('yprice')
    expect(priceUsd).to.be.greaterThan(0)
  })

  it.skipIf(!process.env.PRICE_SERVICE_API_KEY)('returns priceservice for historic BOLD', async function() {
    // BOLD (Liquity v2) is not supported by Lens, so it falls through to price service
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0x6440f144b7e50D6a8439336510312d2F54beB01D', 25035087n)
    expect(priceUsd).to.be.greaterThan(0)
    expect(priceSource).to.equal('priceservice')
  })
})
