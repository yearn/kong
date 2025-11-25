import assert from 'assert'
import Keyv from 'keyv'
import { refresh15min } from './refresh-15min'

describe('timeseries refresh-15min script', function() {
  it('upserts latest entries per time+component and lowercases addresses', async function() {
    const vaults = [{ chainId: 1, address: '0xABCdef' }]
    const cacheKey = 'timeseries:pps:1:0xabcdef'

    const existing = [
      { time: 123, component: 'humanized', value: 1 },
      { time: 120, component: 'humanized', value: 0.5 },
    ]

    const latestRows = [
      { chainId: 1, address: vaults[0].address, label: 'pps', component: 'humanized', value: 2, time: 123n },
      { chainId: 1, address: vaults[0].address, label: 'pps', component: 'raw', value: 10, time: 123n },
    ]

    const store = new Map()
    const keyv = new Keyv({ store })
    await keyv.set(cacheKey, JSON.stringify(existing))

    await refresh15min({
      keyv,
      getVaults: async () => vaults,
      getLatestTimeseries: async (chainId: number, address: string, label: string) => {
        assert.strictEqual(chainId, 1)
        assert.strictEqual(address, vaults[0].address)
        if (label === 'pps') {
          return latestRows
        }
        return []
      },
    })

    const updated = JSON.parse((await keyv.get(cacheKey)) as string)

    // Sort for stable comparison
    updated.sort((a: any, b: any) => {
      if (a.time === b.time) return a.component.localeCompare(b.component)
      return a.time - b.time
    })

    assert.deepStrictEqual(updated, [
      { time: 120, component: 'humanized', value: 0.5 },
      { time: 123, component: 'humanized', value: 2 },
      { time: 123, component: 'raw', value: 10 },
    ])
  })
})
