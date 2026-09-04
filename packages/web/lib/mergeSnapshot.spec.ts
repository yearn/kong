import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { mergeSnapshot } from './mergeSnapshot'

describe('mergeSnapshot', () => {
  it('lets contract state override stale hook keys while retaining hook-only data', () => {
    const result = mergeSnapshot(
      { origin: 'yearn', defaultOnly: true },
      { pricePerShare: 'fresh', snapshotOnly: true },
      { pricePerShare: 'stale', hookOnly: true }
    )

    assert.deepEqual(result, {
      origin: 'yearn',
      defaultOnly: true,
      pricePerShare: 'fresh',
      snapshotOnly: true,
      hookOnly: true
    })
  })

  it('keeps the hook-enriched asset over the raw contract asset', () => {
    const result = mergeSnapshot(
      { asset: '0xdefault' },
      { asset: '0xraw', pricePerShare: 'fresh' },
      { asset: { address: '0xasset', symbol: 'USDC', decimals: 6 } }
    )

    assert.deepEqual(result.asset, { address: '0xasset', symbol: 'USDC', decimals: 6 })
    assert.equal(result.pricePerShare, 'fresh')
  })

  it('falls back to the contract asset when the hook asset is null or undefined', () => {
    assert.equal(mergeSnapshot({}, { asset: '0xraw' }, { asset: null }).asset, '0xraw')
    assert.equal(mergeSnapshot({}, { asset: '0xraw' }, { asset: undefined }).asset, '0xraw')
  })

  it('handles missing blobs without throwing', () => {
    assert.deepEqual(mergeSnapshot(undefined, { pricePerShare: 'fresh' }, null), { pricePerShare: 'fresh' })
  })
})
