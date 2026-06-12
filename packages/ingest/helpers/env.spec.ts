import { expect } from 'chai'
import { parsePositiveIntDays } from './env'

const ENV = 'CURRENT_PERFORMANCE_LOOKBACK_DAYS_TEST'

describe('parsePositiveIntDays', function() {
  afterEach(function() { delete process.env[ENV] })

  it('returns fallback when unset', function() {
    expect(parsePositiveIntDays(ENV, 7)).to.equal(7)
  })

  it('returns fallback when blank or whitespace', function() {
    process.env[ENV] = ''
    expect(parsePositiveIntDays(ENV, 7)).to.equal(7)
    process.env[ENV] = '   '
    expect(parsePositiveIntDays(ENV, 7)).to.equal(7)
  })

  it('parses a valid positive integer', function() {
    process.env[ENV] = '14'
    expect(parsePositiveIntDays(ENV, 7)).to.equal(14)
  })

  it('throws on zero, negative, float, or non-numeric', function() {
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      process.env[ENV] = bad
      expect(() => parsePositiveIntDays(ENV, 7)).to.throw(ENV)
    }
  })
})
