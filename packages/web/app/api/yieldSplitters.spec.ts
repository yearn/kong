import { strict as assert } from 'node:assert'
import { getActiveYieldSplitterFactories } from './yieldSplitterConfig'

describe('getActiveYieldSplitterFactories', () => {
  it('keeps only non-obsolete yield splitter factories', () => {
    const testFactories = [
      {
        chainId: 747474,
        address: '0x72bd640a903DAE71E1eaA315f31F4dA33C82872d',
        obsolete: true
      },
      {
        chainId: 747474,
        address: '0xfb277c7DfDa414aF824AF08c3596d6c28570347d',
        obsolete: true
      },
      {
        chainId: 747474,
        address: '0x3E13dB939c03c03852407Ca90D5A59183D28dA62'
      },
      {
        chainId: 1,
        address: '0xe28fCC9FB2998ba57754789F6666DAa8C815614D'
      }
    ]

    assert.deepEqual(getActiveYieldSplitterFactories(testFactories), [
      {
        chainId: 747474,
        address: '0x3E13dB939c03c03852407Ca90D5A59183D28dA62'
      },
      {
        chainId: 1,
        address: '0xe28fCC9FB2998ba57754789F6666DAa8C815614D'
      }
    ])
  })
})
