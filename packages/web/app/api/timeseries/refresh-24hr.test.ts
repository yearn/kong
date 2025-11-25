import assert from 'assert'
import Keyv from 'keyv'
import { refresh24hr } from './refresh-24hr'

describe('timeseries refresh-24hr script', function() {
  it('writes flattened timeseries arrays for each vault/label using lowercase addresses', async function() {
    const vaults = [
      { chainId: 1, address: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD' },
      { chainId: 10, address: '0xDEF' },
    ]

    const seriesByKey: Record<string, Array<any>> = {
      'pps-1-0xabcdefabcdefabcdefabcdefabcdefabcdefabcd': [
        {
          chainId: 1,
          address: vaults[0].address,
          label: 'pps',
          component: 'humanized',
          value: 1.23,
          period: '1 day',
          time: 1700000000n,
        },
      ],
      'tvl-c-10-0xdef': [
        {
          chainId: 10,
          address: vaults[1].address,
          label: 'tvl-c',
          component: 'tvl',
          value: 42,
          period: '1 day',
          time: 1800000000n,
        },
      ],
    }

    const store = new Map()
    const keyv = new Keyv({ store })

    const fakeGetFull = async (chainId: number, address: string, label: string) => {
      const key = `${label}-${chainId}-${address.toLowerCase()}`
      return seriesByKey[key] ?? []
    }

    await refresh24hr({
      keyv,
      getVaults: async () => vaults,
      getFullTimeseries: fakeGetFull,
    })

    const ppsKey = 'timeseries:pps:1:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const tvlKey = 'timeseries:tvl-c:10:0xdef'

    const pps = JSON.parse((await keyv.get(ppsKey)) as string)
    const tvl = JSON.parse((await keyv.get(tvlKey)) as string)

    assert.deepStrictEqual(pps, [
      { time: 1700000000, component: 'humanized', value: 1.23 },
    ])
    assert.deepStrictEqual(tvl, [
      { time: 1800000000, component: 'tvl', value: 42 },
    ])
  })
})
