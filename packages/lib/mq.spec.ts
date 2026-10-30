import { expect } from 'chai'
import { PRIORITY_LIMIT } from 'bullmq'
import { LOWEST_PRIORITY, computeConcurrency } from './mq'

describe('mq', function() {
  it('keeps the lowest priority within the bullmq limit', function() {
    expect(LOWEST_PRIORITY).to.be.at.most(PRIORITY_LIMIT)
    expect(2 ** 21).to.be.above(PRIORITY_LIMIT)
  })

  it('computes worker concurrency', async function() {
    const options = {
      min: 1, max: 50,
      threshold: 200  
    }

    expect(computeConcurrency(0, options)).to.equal(1)
    expect(computeConcurrency(1, options)).to.equal(1)
    expect(computeConcurrency(100, options)).to.equal(25)
    expect(computeConcurrency(200, options)).to.equal(50)
    expect(computeConcurrency(2000, options)).to.equal(50)
    expect(computeConcurrency(20_000, options)).to.equal(50)
    expect(computeConcurrency(20_000_000, options)).to.equal(50)
  })
})
