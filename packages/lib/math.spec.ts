import { describe, expect, it } from 'vitest'
import { div, max, min } from './math'

describe('math', function() {
  describe('div', function() {
    it('NaN on zero denominator', async function() {
      expect(div(1n, 0n)).to.be.NaN
    })
  
    it('.5 on 1/2', async function() {
      expect(div(1n, 2n)).to.eq(0.5)
    })
  })

  it('mins', async function() {
    expect(min(1n, 2n)).to.eq(1n)
    expect(min(2n, 1n)).to.eq(1n)
  })

  it('maxs', async function() {
    expect(max(1n, 2n)).to.eq(2n)
    expect(max(2n, 1n)).to.eq(2n)
  })
})
