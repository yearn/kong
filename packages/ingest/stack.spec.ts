import { expect } from 'chai'
import { Stack } from 'lib/helpers/tests'

describe('Stack', function () {
  this.timeout(10 * 60 * 1000)

  let stack: Stack

  before(async () => {
    stack = await Stack.start({
      chains: { chains: ['mainnet'] },
      abis: {
        abis: [{
          abiPath: 'yearn/3/vault',
          sources: [{
            chainId: 1,
            address: '0x028eC7330ff87667b6dfb0D94b954c820195336c',
            inceptBlock: 18074804
          }]
        }]
      },
      env: {
        HTTP_FULLNODE_1: process.env.HTTP_FULLNODE_1 || '',
        HTTP_ARCHIVE_1: process.env.HTTP_ARCHIVE_1 || ''
      }
    })
  })

  after(async () => {
    await stack?.stop()
  })

  it('runs fanout abis and serves web', async () => {
    await stack.fanoutAbis()
    await stack.waitIdle(5 * 60 * 1000)

    const res = await stack.fetch('/api/gql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ vaults { chainId address name } }' })
    })
    expect(res.status).to.eq(200)

    const body = await res.json() as { data?: { vaults: { chainId: number, address: string, name: string }[] } }
    expect(body.data?.vaults).to.be.an('array')

    const [{ count }] = await stack.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM evmlog')
    expect(Number(count)).to.be.greaterThan(0)
  })
})
