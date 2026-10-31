import { expect } from 'chai'
import { PRIORITY_LIMIT } from 'bullmq'
import { LOWEST_PRIORITY, computeConcurrency, workerLockOptions } from './mq'

describe('mq', function() {
  it('keeps the lowest priority within the bullmq limit', function() {
    expect(LOWEST_PRIORITY).to.be.at.most(PRIORITY_LIMIT)
    expect(2 ** 21).to.be.above(PRIORITY_LIMIT)
  })

  it('uses lock settings that tolerate long jobs', function() {
    const opts = workerLockOptions()
    expect(opts.lockDuration).to.be.at.least(60_000)
    expect(opts.lockRenewTime).to.be.below(opts.lockDuration)
    expect(opts.stalledInterval).to.be.above(0)
  })

  it('reads lock settings from env and ignores invalid values', function() {
    process.env.MQ_LOCK_DURATION_MS = '120000'
    process.env.MQ_STALLED_INTERVAL_MS = 'nope'
    const opts = workerLockOptions()
    expect(opts.lockDuration).to.equal(120_000)
    expect(opts.lockRenewTime).to.equal(30_000)
    expect(opts.stalledInterval).to.equal(60_000)
    delete process.env.MQ_LOCK_DURATION_MS
    delete process.env.MQ_STALLED_INTERVAL_MS
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
