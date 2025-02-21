import { expect } from 'chai'
import { getRiskScore } from './risk'
import { mainnet } from 'viem/chains'
import { zeroAddress } from 'viem'

describe.skip('abis/yearn/lib/risk', function() {
  it('extracts risk groups', async function(this: Mocha.Context) {
    const group = await getRiskScore(mainnet.id, '0x57b3255af547b5efb9c7906d97e40659dce0f5ef')
    expect(group).to.not.be.undefined
    expect(group?.label).to.equal('88mph deposit')
    expect(await getRiskScore(mainnet.id, zeroAddress)).to.be.undefined
  })
})
