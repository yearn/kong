import { expect } from 'chai'
import { rpcs } from '../../../../../rpcs'
import { extractAggregateTvlTarget } from './hook'

describe('abis/yearn/3/strategy/snapshot/hook', function() {
  describe('extractAggregateTvlTarget', function() {
    const destination = '0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204'

    it('targets the depositor vault from vault() or VAULT()', async function() {
      expect(await extractAggregateTvlTarget(1, { vault: destination })).to.deep.equal({ chainId: 1, address: destination })
      expect(await extractAggregateTvlTarget(1, { VAULT: destination })).to.deep.equal({ chainId: 1, address: destination })
    })

    it('targets nothing without a destination', async function() {
      expect(await extractAggregateTvlTarget(1, {})).to.equal(null)
      expect(await extractAggregateTvlTarget(1, { vault: '0x0000000000000000000000000000000000000000' })).to.equal(null)
    })

    it('targets the remote counterpart vault on the remote chain', async function() {
      const remote = '0x80c34BD3A3569E126e7055831036aa7b212cB159'
      const readContract = vi.fn().mockResolvedValue(remote)
      const next = vi.spyOn(rpcs, 'next').mockReturnValue({ readContract } as never)
      try {
        expect(await extractAggregateTvlTarget(1, {
          REMOTE_COUNTERPART: '0xEfEEBaAcdC5640A123Fe282652503ea4Fd499d14', REMOTE_CHAIN_ID: 747474n,
        })).to.deep.equal({ chainId: 747474, address: remote })
        expect(next.mock.calls[0][0]).to.equal(747474)
      } finally {
        next.mockRestore()
      }
    })
  })
})
