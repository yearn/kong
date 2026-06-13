import { expect } from 'chai'
import { base, mainnet } from 'viem/chains'
import { _compute } from './hook'
import { ThingSchema } from 'lib/types'

describe('abis/erc4626/timeseries/pps/hook', function() {
  it('extracts sdai pps', async function() {
    this.timeout(30_000)

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
    this.timeout(30_000)

    const usdc = '0x944766f715b51967E56aFdE5f0Aa76cEaCc9E7f9'
    const vault = ThingSchema.parse({
      chainId: base.id,
      address: usdc,
      label: 'vault',
      // 6-decimal shares and 6-decimal USDC asset (matches what extraction stores)
      defaults: { decimals: 6 }
    })
    const pps = await _compute(vault, 37288756n)
    expect(pps.humanized).to.be.closeTo(1.2807073904123205, 1e-5)
  })

  it('uses share decimals when they differ from asset decimals', async function() {
    this.timeout(30_000)

    // Yearn USDT (Morpho): 18-decimal shares, 6-decimal USDT asset.
    // defaults.decimals holds the asset decimals (6); convertToAssets needs the
    // share decimals (18) or it rounds to 0. Pre-fix this returned 0.
    const vault = ThingSchema.parse({
      chainId: mainnet.id,
      address: '0x0963232eB842BAF53E8e517691f81745C1F228a0',
      label: 'vault',
      defaults: { decimals: 6 }
    })
    const pps = await _compute(vault, 25211174n)
    expect(Number(pps.raw)).to.equal(1002039)
    expect(pps.humanized).to.be.closeTo(1.002039, 1e-5)
  })
})
