import { expect } from 'chai'
import { base, mainnet } from 'viem/chains'
import { _compute } from './hook'
import { ThingSchema } from 'lib/types'

describe('abis/erc4626/timeseries/pps/hook', function() {
  it('extracts sdai pps', async function() {
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

  it('extracts avantis usdc pps', async function() {
    const usdc = '0x944766f715b51967E56aFdE5f0Aa76cEaCc9E7f9'
    const vault = ThingSchema.parse({
      chainId: base.id,
      address: usdc,
      label: 'vault',
      defaults: { decimals: 18 }
    })
    const pps = await _compute(vault, 37288756n)
    expect(pps.humanized).to.be.closeTo(1.2807073904123205, 1e-5)
  })
})
