import { expect } from 'chai'
import { _compute, tvlExploded, MAX_PLAUSIBLE_TVL_USD } from './tvl'
import { ThingSchema } from 'lib/types'
import { addresses } from '../../../test-addresses'

describe('abis/yearn/lib/tvl', function() {
  it('yvWETH 0.4.2 @ block 18417431', async function(this: Mocha.Context) {
    const yvweth = ThingSchema.parse({
      chainId: 1,
      address: addresses.v2.yvweth,
      label: 'vault',
      defaults: {
        apiVersion: '0.4.2',
        registry: '0xe15461b18ee31b7379019dc523231c57d1cbc18c',
        asset: addresses.v2.weth,
        decimals: 18,
        inceptBlock: 12588794,
        inceptTime: 1623088086
      }
    })

    const blockNumber = 18417431n
    const { priceUsd, tvl } = await _compute(yvweth, blockNumber)
    expect(priceUsd).to.be.almost(1_833, 1)
    expect(tvl).to.be.almost(107_045_649, 1)
  })

  describe('tvlExploded', function() {
    it('passes plausible tvl', function() {
      expect(tvlExploded(0)).to.be.false
      expect(tvlExploded(107_045_649)).to.be.false
      expect(tvlExploded(MAX_PLAUSIBLE_TVL_USD)).to.be.false
    })

    it('flags exploded and non-finite tvl', function() {
      expect(tvlExploded(MAX_PLAUSIBLE_TVL_USD + 1)).to.be.true
      expect(tvlExploded(7e15)).to.be.true // dead Curve LP mispriced by ydaemon
      expect(tvlExploded(Infinity)).to.be.true
      expect(tvlExploded(NaN)).to.be.true
    })
  })
})
