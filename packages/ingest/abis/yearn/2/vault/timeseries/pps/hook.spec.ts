import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import { _compute } from './hook'
import { ThingSchema } from 'lib/types'
import { addresses } from '../../../../../../test.fixture'

describe('abis/yearn/2/vault/timeseries/pps/hook', function() {
  it('extracts pps', async function() {
    const vault = ThingSchema.parse({
      chainId: mainnet.id,
      address: addresses.v2.yvusdt,
      label: 'vault',
      defaults: { decimals: 6 }
    })
    const pps = await _compute(vault, 18344466n)
    expect(pps.humanized).to.be.closeTo(1.023043, 1e-5)
  })
})
