import { expect } from 'chai'
import { HarvestSchema, computeApr } from './hook'
import { addresses } from '../../../../../test.fixture'

function mock() {
  return HarvestSchema.parse({
    chainId: 1,
    address: addresses.v2.strategystEthAccumulator_v2,
    blockNumber: 17613565n,
    blockTime: 1n,
    args: {
      profit: 122295812297070635612n,
      loss: 0n,
      debtPayment: 0n,
      debtOutstanding: 0n
    }
  })
}

describe('abis/yearn/2/strategy/event/Harvested/hook', function() {
  it('zeros apr on zero debt', async function() {
    const zeroDebt = {...mock(), args: { ...mock().args, profit: 0n } }
    const apr = await computeApr(zeroDebt, mock())
    expect(apr.gross).to.equal(0)
    expect(apr.net).to.equal(0)
  })

  it('computes gross and net apr on profit', async function() {
    const latest = { 
      ...mock(),
      blockNumber: 18116044n,
      blockTime: BigInt(70 * 24 * 60 * 60 + (9 * 60 * 60)),
      args: { ...mock().args,
        profit: 194459789900456241429n
      } 
    }

    const apr = await computeApr(latest, mock())
    expect(apr.gross).to.equal(0.039971418235301995)
    expect(apr.net).to.equal(0.0319771345882416)
  })

  it('computes gross and net apr on loss', async function() {
    const zero = { 
      ...mock(),
      args: { ...mock().args,
        profit: 0n,
        loss: 0n
      } 
    }

    const loss = { 
      ...zero,
      blockNumber: 18116044n,
      blockTime: BigInt(24 * 60 * 60),
      args: { ...mock().args,
        profit: 0n,
        loss: 523277537563798n
      } 
    }

    const apr = await computeApr(loss, zero)
    expect(apr.gross).to.equal(-0.000007893987681245217)
    expect(apr.net).to.equal(apr.gross)
  })
})
