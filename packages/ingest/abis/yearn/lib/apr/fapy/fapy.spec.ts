import { beforeAll } from 'bun:test'
import { computeChainAPY } from '.'
import db from '../../../../../db'
import { crvStrategy1Insert, crvStrategy1SnapshotInsert, crvStrategy2Insert, crvStrategy2SnapshotInsert, crvVaultInsert, crvVaultSnapshotInsert } from './__mock__/crv.mock'
import { getVaultStrategies } from 'lib/queries/strategy'
import { getThingWithName } from 'lib/queries/thing'

describe('fapy', () => {
  describe('crv-like', () => {
    beforeAll(async () => {
      await db.query(crvVaultInsert)
      await db.query(crvVaultSnapshotInsert)
      await db.query(crvStrategy1Insert)
      await db.query(crvStrategy2Insert)
      await db.query(crvStrategy1SnapshotInsert)
      await db.query(crvStrategy2SnapshotInsert)
    })
    it('should correct apy for Curve reUSD-scrvUSD', async function (done) {
      const vaultAddress = '0xf165a634296800812B8B0607a75DeDdcD4D3cC88'
      const chainId = 1
      const vault = await getThingWithName(chainId, vaultAddress, 'vault')
      const strategies = await getVaultStrategies(chainId, vaultAddress)

      const fapy = await computeChainAPY(vault, chainId, strategies)

    })
  })
})
