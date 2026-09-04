import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { mergeSnapshot, mergeSnapshotSql } from './mergeSnapshot'

describe('mergeSnapshot', () => {
  it('keeps SQL blob precedence and hook asset override aligned with mergeSnapshot', () => {
    const sql = mergeSnapshotSql(['composition'])
    const defaults = 'COALESCE(thing.defaults, \'{}\')'
    const hook = 'COALESCE(snapshot.hook, \'{}\')'
    const snapshot = 'COALESCE(snapshot.snapshot, \'{}\')'

    assert.ok(sql.indexOf(defaults) < sql.indexOf(hook))
    assert.ok(sql.indexOf(hook) < sql.indexOf(snapshot))
    assert.match(sql, /jsonb_strip_nulls\(jsonb_build_object\('asset', snapshot\.hook->'asset'\)\)/)
    assert.match(sql, /- ARRAY\['composition'\]::text\[\]/)
  })

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
