import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import { addresses } from '../../../../../../test-addresses'
import { extractTrancheAccounting, extractTrancheMeta, extractTranchesByPriority } from './hook'

// Fixed block after all three tranches were registered.
const BLOCK = 25600000n
const { controller, a, b, e } = addresses.tranche

describe('abis/yearn/3/tranche/controller/snapshot/hook', function() {
  it('discovers the deployed tranches in priority order', async function() {
    const discovered = await extractTranchesByPriority(mainnet.id, controller, 3n, BLOCK)
    expect(discovered).to.deep.equal([a, b, e])
  })

  it('discovers nothing when the controller has no tranches', async function() {
    expect(await extractTranchesByPriority(mainnet.id, controller, 0n, BLOCK)).to.deep.equal([])
    expect(await extractTranchesByPriority(mainnet.id, controller, undefined, BLOCK)).to.deep.equal([])
  })

  it('reads controller accounting per tranche', async function() {
    const accounting = await extractTrancheAccounting(mainnet.id, controller, [a, e], BLOCK)

    expect(accounting.map(entry => entry.address)).to.deep.equal([a, e])
    expect(accounting.map(entry => entry.priority)).to.deep.equal([0, 1])

    const [senior] = accounting
    expect(senior.registered).to.equal(true)
    expect(senior.accrualPaused).to.equal(false)
    expect(senior.excessShareBps).to.equal(0)
    expect(senior.targetRatePerSecondWad).to.equal(1584436925n)
    expect(senior.baselineAssets).to.equal(1000000256n)
    expect(senior.liveAssets).to.equal(1000448417n)
    expect(senior.claim).to.equal(1000448417n)
    expect(senior.covered).to.equal(1000448417n)
    expect(senior.pendingExcess).to.equal(0n)
  })

  it('reads tranche metadata and implementation type', async function() {
    // base and locked are implementations; A/B/E are deployment configuration
    expect(await extractTrancheMeta(mainnet.id, a, BLOCK)).to.deep.equal({
      name: 'yvUSD Fixed', symbol: 'yvUSD-A', decimals: 6, apiVersion: '3.1.0', trancheType: 'base'
    })

    expect(await extractTrancheMeta(mainnet.id, e, BLOCK)).to.deep.equal({
      name: 'yvUSD Equity', symbol: 'yvUSD-E', decimals: 6, apiVersion: '3.1.0', trancheType: 'locked'
    })
  })
})
