import { expect } from 'chai'
import { polygon } from 'viem/chains'
import { chains } from 'lib'
import { ThingSchema } from 'lib/types'
import { addresses } from '../../../../../../test-addresses'
import * as shared from '../../../../2/vault/timeseries/pps/hook'
import process from './hook'

const hasPolygon = chains.some(chain => chain.id === polygon.id)

describe('abis/yearn/3/vault/timeseries/pps/hook', function() {
  it.skipIf(!hasPolygon)('reads and humanizes pricePerShare for a v3 vault', async function() {
    const vault = ThingSchema.parse({
      chainId: polygon.id,
      address: addresses.v3.yvusdca,
      label: 'vault',
      defaults: { decimals: 6 }
    })
    const pps = await shared._compute(vault, 52031869n)

    expect(pps.raw).to.equal(1027028n)
    expect(pps.humanized).to.equal(1.027028)
  })

  it('forwards timeseries requests to the shared Yearn vault hook', async function() {
    const output = {
      chainId: polygon.id,
      address: addresses.v3.yvusdca,
      label: 'pps',
      component: 'raw',
      value: 1027028,
      blockNumber: 52031869n,
      blockTime: 1704600807n
    }
    const data = {
      abiPath: 'yearn/3/vault',
      chainId: polygon.id,
      address: addresses.v3.yvusdca,
      outputLabel: 'pps',
      blockTime: 1704600807n
    }
    const delegate = vi.spyOn(shared, 'default').mockResolvedValue([output])

    try {
      expect(await process(polygon.id, addresses.v3.yvusdca, data)).to.deep.equal([output])
      expect(delegate.mock.calls).to.deep.equal([[polygon.id, addresses.v3.yvusdca, data]])
    } finally {
      delegate.mockRestore()
    }
  })
})
