import { expect } from 'chai'
import { zeroAddress } from 'viem'
import { mainnet } from 'viem/chains'
import { addresses } from '../../../../../../test-addresses'
import process_, { extractHookState } from './hook'

const BLOCK = 25600000n
const { a: TRANCHE, hook: HOOK } = addresses.tranche

// The automatic snapshot for a tranche, as the extractor would hand it over:
// zero-argument reads, with `hook` holding the Hook's address.
const automaticSnapshot = {
  blockNumber: BLOCK,
  blockTime: 1784864807n,
  name: 'yvUSD Fixed',
  symbol: 'yvUSD-A',
  decimals: 6,
  open: true,
  hook: HOOK
}

describe('abis/yearn/3/tranche/vault/snapshot/hook', function() {
  it.skipIf(!process.env.HTTP_ARCHIVE_1)('appends hookState and leaves the raw hook address alone', async function() {
    const result = await process_(mainnet.id, TRANCHE, automaticSnapshot)

    // the address stays where the automatic snapshot put it, and enrichment adds
    // no competing top-level `hook`
    expect(Object.keys(result)).to.deep.equal(['hookState'])
    expect(automaticSnapshot.hook).to.equal(HOOK)

    const { hookState } = result as { hookState: Record<string, unknown> }
    expect(hookState.open).to.equal(true)
    expect(hookState.rateLimitWindow).to.equal(3600n)
    expect(hookState.depositLimit).to.equal(1000000000000n)
    expect(hookState.depositCap).to.equal(100000000000n)
    expect(hookState.withdrawCap).to.equal(2000980608n)
    expect(hookState.depositRateLimit).to.deep.equal({
      used: 1000000000n, windowStart: 1784581631n, rateLimit: 100000000000n
    })
    expect(hookState.withdrawRateLimit).to.deep.equal({
      used: 0n, windowStart: 0n, rateLimit: 100000000000n
    })
  })

  it('clears hookState when the tranche has no hook', async function() {
    expect(await process_(mainnet.id, TRANCHE, { blockNumber: BLOCK })).to.deep.equal({ hookState: null })
    expect(await process_(mainnet.id, TRANCHE, { blockNumber: BLOCK, hook: zeroAddress })).to.deep.equal({ hookState: null })
  })

  it.skipIf(!process.env.HTTP_ARCHIVE_1)('clears a populated hookState when the hook becomes zero or incompatible', async function() {
    const populated = await process_(mainnet.id, TRANCHE, automaticSnapshot)
    expect(populated.hookState).to.not.equal(null)

    const zeroed = await process_(mainnet.id, TRANCHE, { ...automaticSnapshot, hook: zeroAddress })
    expect({ ...populated, ...zeroed }.hookState).to.equal(null)

    const incompatible = await process_(mainnet.id, TRANCHE, { ...automaticSnapshot, hook: addresses.tranche.mainVault })
    expect({ ...populated, ...incompatible }.hookState).to.equal(null)
  })

  it.skipIf(!process.env.HTTP_ARCHIVE_1)('skips enrichment when the hook does not implement the interface', async function() {
    // the raw address is stored either way; that is what a reader investigates
    expect(await extractHookState(mainnet.id, addresses.tranche.mainVault, TRANCHE, BLOCK)).to.equal(undefined)
  })
})
