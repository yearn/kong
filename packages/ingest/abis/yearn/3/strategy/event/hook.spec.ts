import { expect } from 'chai'
import { HarvestSchema, computeApr, totalAssets } from './hook'
import { addresses } from '../../../../../test.fixture'

function mock() {
  return HarvestSchema.parse({
    chainId: 137,
    address: addresses.v3.aaveV3UsdcLender,
    blockNumber: 51413288n,
    blockTime: 1n,
    args: {
      profit: 0n,
      loss: 0n,
      protocolFees: 0n,
      performanceFees: 0n
    }
  })
}

describe('abis/yearn/3/strategy/event/hook', function() {
  it('extracts totalDebt', async function() {
    const debt = await totalAssets(mock())
    expect(debt).to.equal(10489089449n)
  })

  it('extracts zero totalDebt', async function() {
    const debt = await totalAssets({...mock(), address: addresses.rando })
    expect(debt).to.equal(0n)
  })

  it('zeros apr on zero debt', async function() {
    const zeroDebt = {...mock(), address: addresses.rando }
    const apr = await computeApr(zeroDebt, zeroDebt)
    expect(apr.gross).to.equal(0)
    expect(apr.net).to.equal(0)
  })

  it('computes gross and net apr on profit', async function() {
    const latest = {
      ...mock(),
      blockNumber: 51916666n,
      blockTime: BigInt(70 * 24 * 60 * 60 + (9 * 60 * 60)),
      args: {
        profit: 1209748995n,
        loss: 0n,
        protocolFees: 29748995n,
        performanceFees: 89748995n
      }
    }

    const apr = await computeApr(latest, {...mock(), blockNumber: 51916665n})
    expect(apr.gross).to.equal(0.05179518421103771)
    expect(apr.net).to.equal(0.04795259723804295)
  })

  it('computes gross and net apr on loss', async function() {
    const latest = {
      ...mock(),
      blockNumber: 51916666n,
      blockTime: BigInt(70 * 24 * 60 * 60 + (9 * 60 * 60)),
      args: {
        profit: 0n,
        loss: 1209748995n,
        protocolFees: 0n,
        performanceFees: 89748995n
      }
    }

    const apr = await computeApr(latest, {...mock(), blockNumber: 51916665n})
    expect(apr.gross).to.equal(-0.05179518421103771)
    expect(apr.net).to.equal(apr.gross)
  })
})
