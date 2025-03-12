import { expect } from 'chai'
import { _compute } from './tvl'
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
})
