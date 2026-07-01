import { strict as assert } from 'node:assert'
import { clampLimit, resolvePeriod, MAX_GQL_LIMIT } from './guards'

describe('clampLimit', () => {
  it('defaults to 100 when omitted', () => {
    assert.equal(clampLimit(), 100)
    assert.equal(clampLimit(null), 100)
  })

  it('passes through values within range', () => {
    assert.equal(clampLimit(30), 30)
  })

  it('caps values above the max', () => {
    assert.equal(clampLimit(1_000_000), MAX_GQL_LIMIT)
  })

  it('rejects non-positive or non-integer limits', () => {
    assert.throws(() => clampLimit(0))
    assert.throws(() => clampLimit(-5))
    assert.throws(() => clampLimit(1.5))
  })
})

describe('resolvePeriod', () => {
  it('defaults to 1 day when omitted', () => {
    assert.equal(resolvePeriod(), '1 day')
    assert.equal(resolvePeriod(null), '1 day')
  })

  it('passes through allowlisted periods', () => {
    assert.equal(resolvePeriod('1 hour'), '1 hour')
    assert.equal(resolvePeriod('1 week'), '1 week')
  })

  it('rejects sub-day and arbitrary interval strings', () => {
    assert.throws(() => resolvePeriod('1 second'))
    assert.throws(() => resolvePeriod('30 minutes'))
    assert.throws(() => resolvePeriod('1 day; DROP TABLE output;--'))
  })
})
