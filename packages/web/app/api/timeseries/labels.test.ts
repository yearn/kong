import assert from 'assert'
import { labels } from './labels'

describe('timeseries labels manifest', function() {
  it('defines expected segments and defaults', function() {
    const segments = labels.map(label => label.segment)
    assert.deepStrictEqual(segments, ['pps', 'apy-historical', 'tvl'])

    assert.strictEqual(labels.find(label => label.segment === 'pps')?.defaultComponent, 'humanized')
    assert.strictEqual(labels.find(label => label.segment === 'apy-historical')?.defaultComponent, 'net')
    assert.strictEqual(labels.find(label => label.segment === 'tvl')?.defaultComponent, 'tvl')
  })

  it('uses unique segments', function() {
    assert.strictEqual(new Set(labels.map(label => label.segment)).size, labels.length)
  })
})
