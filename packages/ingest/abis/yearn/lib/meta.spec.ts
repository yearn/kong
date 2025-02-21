import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import { getStrategyMeta, getTokenMeta, getVaultMeta } from './meta'
import { zeroAddress } from 'viem'

describe('abis/yearn/lib/meta', function() {
  it('extracts vault meta', async function(this: Mocha.Context) {
    const meta = await getVaultMeta(mainnet.id, '0x028ec7330ff87667b6dfb0d94b954c820195336c')
    expect(meta).to.not.be.undefined
    expect(meta.displayName).to.equal('DAI')
    expect(meta.displaySymbol).to.equal('yvDAI')
    expect(await getVaultMeta(mainnet.id, zeroAddress)).to.be.undefined
  })

  it('extracts strategy meta', async function(this: Mocha.Context) {
    const meta = await getStrategyMeta(mainnet.id, '0x000007252ab8d9120005d30aa15567ea8de9a110')
    expect(meta).to.not.be.undefined
    expect(meta.displayName).to.equal('Convex Reinvest')
    expect(await getStrategyMeta(mainnet.id, zeroAddress)).to.be.undefined
  })

  it('extracts token meta', async function(this: Mocha.Context) {
    const meta = await getTokenMeta(mainnet.id, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    expect(meta).to.not.be.undefined
    expect(meta.displayName).to.equal('USD Coin')
    expect(meta.displaySymbol).to.equal('USDC')
    expect(await getTokenMeta(mainnet.id, '0x0000000000000000000000000000000000000001')).to.be.undefined
  })
})
