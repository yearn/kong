import { expect } from 'chai'
import { __estimateHeight } from './blocks'

describe('blocks', function() {
  it('estimates block height', async function() {
    this.timeout(5_000)
    const result = await __estimateHeight(1, 1716356553n)
    const ranged = result >= 19923410n && result <= 19923414n
    if (!ranged) console.error ('result', result)
    expect (ranged).to.be.true
  })
})
