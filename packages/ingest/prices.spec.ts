import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import { fetchErc20PriceUsd } from './prices'

describe('prices', function() {
  this.timeout(2 * 60_000) // TODO: yprice is in beta, expect delays

  before(async function() {
    this.block = 18166519n
  })

  it('returns ydaemon price for latest WETH', async function() {
    const doesntMatterWhichBlock = 13n
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', doesntMatterWhichBlock, true)
    expect(priceSource).to.equal('ydaemon')
    expect(priceUsd).to.be.greaterThan(0)
  })

  it('returns lens price for historic WETH', async function() {
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', this.block)
    expect(priceSource).to.equal('lens')
    expect(priceUsd).to.be.greaterThan(0)
  })

  it('returns yprice for yvCurve-clevCVX-f-f', async function() {
    if(!JSON.parse(process.env.YPRICE_ENABLED || 'false')) return this.skip()
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0xc869206adAfD3D874dB22e8BbA662E05F6257613', this.block)
    expect(priceSource).to.equal('yprice')
    expect(priceUsd).to.be.greaterThan(0)
  })

  it('returns yprice for crvGEARETH-f', async function() {
    if(!JSON.parse(process.env.YPRICE_ENABLED || 'false')) return this.skip()
    const { priceSource, priceUsd } = await fetchErc20PriceUsd(mainnet.id, '0x5Be6C45e2d074fAa20700C49aDA3E88a1cc0025d', this.block)
    expect(priceSource).to.equal('yprice')
    expect(priceUsd).to.be.greaterThan(0)
  })
})
