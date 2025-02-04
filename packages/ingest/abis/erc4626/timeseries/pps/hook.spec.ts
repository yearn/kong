import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import { _compute } from './hook'
import { ThingSchema } from 'lib/types'

describe('abis/erc4626/timeseries/pps/hook', function() {
  it('extracts pps', async function() {
    const sdai = '0x83F20F44975D03b1b09e64809B757c47f942BEeA'
    const vault = ThingSchema.parse({
      chainId: mainnet.id,
      address: sdai,
      label: 'vault',
      defaults: { decimals: 18 }
    })
    const pps = await _compute(vault, 20585222n)
    expect(pps.humanized).to.be.closeTo(1.1040043785400659, 1e-5)
  })
})
