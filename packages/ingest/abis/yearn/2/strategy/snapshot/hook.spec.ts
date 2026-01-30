import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import process, { extractLenderStatuses } from './hook'
import { cache } from 'lib'

describe('abis/yearn/2/strategy/snapshot/hook', function() {
  const originalFetch = global.fetch
  const address = '0x2216E44fA633ABd2540dB72Ad34b42C7F1557cd4'
  const chainId = mainnet.id

  beforeEach(async function() {
    await cache.del(`abis/yearn/lib/meta/strategies/${chainId}`)
  })

  afterEach(function() {
    global.fetch = originalFetch
  })

  it('extracts lender statuses', async function() {
    const statuses = await extractLenderStatuses(mainnet.id, '0x2216E44fA633ABd2540dB72Ad34b42C7F1557cd4', 18530014n)
    expect(statuses).to.be.an('array')
    expect(statuses).to.have.length(2)
    expect(statuses[1]).to.deep.equal({
      name: 'GenericCompV3',
      assets: 1125403759558n,
      rate: 63939160081334480n,
      address: '0x2eD5eAf929Fee1F5F9B32d83dB8ed06b52692A74'
    })
  })

  it('extracts no lender statuses', async function() {
    const statuses = await extractLenderStatuses(mainnet.id, '0x120FA5738751b275aed7F7b46B98beB38679e093', 18530014n)
    expect(statuses).to.be.an('array')
    expect(statuses).to.have.length(0)
  })

  it('returns undefined meta when validation fails', async function() {
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString().includes('cms.yearn.fi')) {
        return {
          json: async () => ([{
            address,
            chainId,
            name: 'Invalid Strategy',
            // Missing required fields
          }])
        } as any
      }
      return originalFetch(input, init)
    }

    const result = await process(chainId, address, {
      // Use a borked vault address to bypass extractTotalDebt RPC call
      vault: '0x718AbE90777F5B778B52D553a5aBaa148DD0dc5D',
      want: '0x0000000000000000000000000000000000000000'
    })

    expect(result.meta).to.be.undefined
  })
})
