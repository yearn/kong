import { strict as assert } from 'node:assert'
import { estimateMSetRequestSize, splitPairsForMSet } from './cache'

describe('splitPairsForMSet', () => {
  it('keeps all pairs in one chunk when below the target', () => {
    const pairs: Array<[string, string]> = [
      ['alpha', '1'],
      ['beta', '2'],
    ]

    const chunks = splitPairsForMSet(pairs, estimateMSetRequestSize(pairs) + 1)

    assert.deepEqual(chunks, [pairs])
  })

  it('splits pairs into ordered chunks below the target', () => {
    const pairs: Array<[string, string]> = [
      ['alpha', 'x'.repeat(32)],
      ['beta', 'y'.repeat(32)],
      ['gamma', 'z'.repeat(32)],
    ]

    const singlePairSize = estimateMSetRequestSize([pairs[0]])
    const targetBytes = singlePairSize + 10
    const chunks = splitPairsForMSet(pairs, targetBytes)

    assert.deepEqual(chunks, [
      [pairs[0]],
      [pairs[1]],
      [pairs[2]],
    ])
  })

  it('throws when a single pair exceeds the Redis hard limit', () => {
    const tooLarge: Array<[string, string]> = [
      ['huge', 'x'.repeat((10 * 1024 * 1024) + 1)],
    ]

    assert.throws(() => splitPairsForMSet(tooLarge), /exceeds hard limit/)
  })
})
