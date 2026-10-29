import { expect } from 'chai'
import { div, max, min, priced } from './math'

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

  it('prices balances below 0.0001 without truncating them', async function() {
    expect(priced(1686465000000n, 18, 96_160_000)).to.be.closeTo(162.17, 0.01)
    expect(priced(5_000000000000000000n, 18, 2)).to.eq(10)
  })

  it('maxs', async function() {
    expect(max(1n, 2n)).to.eq(2n)
    expect(max(2n, 1n)).to.eq(2n)
  })
})
