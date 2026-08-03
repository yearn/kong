import { strict as assert } from 'node:assert'
import { selectShard } from './shard'

const items = Array.from({ length: 500 }, (_, i) => ({ id: `1:0x${i.toString(16)}` }))
const key = (item: { id: string }) => item.id

describe('selectShard', () => {
  it('returns everything when no shard is given', () => {
    assert.equal(selectShard(items, key).length, items.length)
  })

  it('covers every item exactly once across a full rotation', () => {
    const seen = items.flatMap((_, index) =>
      index < 24 ? selectShard(items, key, { index, total: 24 }).map(key) : [])

    assert.equal(seen.length, items.length)
    assert.equal(new Set(seen).size, items.length)
  })

  it('keeps an item in its shard as the list grows', () => {
    const shard = { index: 7, total: 24 }
    const before = selectShard(items, key, shard).map(key)
    const grown = [{ id: '1:0xnew' }, ...items, { id: '10:0xother' }]

    const after = selectShard(grown, key, shard).map(key)

    assert.deepEqual(before, after.filter((id) => id !== '1:0xnew' && id !== '10:0xother'))
  })
})
