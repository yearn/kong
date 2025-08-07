import { describe, it } from 'mocha'
import 'lib/global'
import db from 'ingest/db'
import { expect } from 'chai'
import { computeChainAPY } from '.'
import * as crvMock from './__mock__/crv.mock'
import { getVaultStrategies } from 'lib/queries/strategy'
import { getThingWithName } from 'lib/queries/thing'

describe('fapy', () => {
  before(async () => {
    await db.query(crvMock.crvVaultInsert)
    await db.query(crvMock.crvVaultSnapshotInsert)
    await db.query(crvMock.crvStrategy1Insert)
    await db.query(crvMock.crvStrategy1SnapshotInsert)
    await db.query(crvMock.crvStrategy2Insert)
    await db.query(crvMock.crvStrategy2SnapshotInsert)
  })

  it('computes fAPY for a crv vault', async () => {
    const ydaemonExpected = {
      'apr': {
        'netAPR': 0.221712532070249,
        'forwardAPR': {
          'type': 'crv',
          'netAPR': 0.256593418335934,
          'composite': {
            'boost': 2.25235977747574,
            'poolAPY': 0.0205,
            'boostedAPR': 0.264603798151038,
            'baseAPR': 0.117478477815647,
            'cvxAPR': 0,
            'rewardsAPR': 0
          }
        }
      },
    }
    const vault = await getThingWithName(1, '0xf165a634296800812B8B0607a75DeDdcD4D3cC88')

    const strategies = await getVaultStrategies(1, vault!.address)

    const result = await computeChainAPY(vault, 1, strategies)

    expect(result!.netAPR).to.be.closeTo(ydaemonExpected.apr.netAPR, 1e-3)
    expect(result!.boostedAPR).to.be.closeTo(ydaemonExpected.apr.forwardAPR.composite.boostedAPR, 1e-3)
    expect(result!.poolAPY).to.be.closeTo(ydaemonExpected.apr.forwardAPR.composite.poolAPY, 1e-3)
    expect(result!.boost).to.be.closeTo(ydaemonExpected.apr.forwardAPR.composite.boost, 1e-3)
    expect(result!.baseAPR).to.be.closeTo(ydaemonExpected.apr.forwardAPR.composite.baseAPR, 1e-3)
    expect(result!.cvxAPR).to.be.closeTo(ydaemonExpected.apr.forwardAPR.composite.cvxAPR, 1e-5)
    expect(result!.rewardsAPR).to.be.closeTo(ydaemonExpected.apr.forwardAPR.composite.rewardsAPR, 1e-5)
  }).timeout(10000)
})
