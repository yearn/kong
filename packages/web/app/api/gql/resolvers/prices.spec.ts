import { strict as assert } from 'node:assert'
import prices from './prices'

describe('prices resolver', () => {
  it('returns [] for any argument combination', async () => {
    assert.deepEqual(await prices({}, {}), [])
    assert.deepEqual(await prices({}, { chainId: 1 }), [])
    assert.deepEqual(
      await prices({}, {
        chainId: 1,
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        timestamp: 0n
      }),
      []
    )
  })

  it('default export is a function that returns [] after the price-table nulling', async () => {
    const mod = await import('./prices')
    assert.equal(typeof mod.default, 'function')
    assert.deepEqual(await mod.default({}, { address: '0x0000000000000000000000000000000000000001' }), [])
  })
})
