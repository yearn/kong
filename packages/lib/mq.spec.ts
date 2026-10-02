import { expect } from 'chai'
import { Queue } from 'bullmq'
import { vi } from 'vitest'
import { addBulk, computeConcurrency, connect, down, job } from './mq'

describe('mq', function() {
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

  describe('addBulk', function() {
    const queues = ['extract-1', 'extract-10', 'load']

    async function clean() {
      for (const name of queues) {
        const queue = connect(name)
        await queue.obliterate({ force: true })
        await queue.close()
      }
    }

    beforeEach(clean)
    afterEach(clean)
    afterAll(down)

    it('chunks bulk adds per queue into slices of 1000', async function() {
      const spy = vi.spyOn(Queue.prototype, 'addBulk')
      try {
        await addBulk(Array.from({ length: 2500 }, (_, n) => ({ job: job.load.thing, data: { n } })))
        expect(spy.mock.calls).to.have.length(3)
      } finally {
        spy.mockRestore()
      }
    })

    it('lands each job in its chain queue with priority and attempts', async function() {
      await addBulk([
        { job: job.extract.evmlog, data: { chainId: 1, n: 1 } },
        { job: job.extract.evmlog, data: { chainId: 10, n: 2 } },
        { job: job.extract.evmlog, data: { chainId: 1, n: 3 }, options: { priority: 7, jobId: 'three' } },
        { job: job.load.thing, data: { n: 4 } }
      ])

      const jobsIn = async (name: string) => {
        const queue = connect(name)
        const jobs = await queue.getJobs(['prioritized', 'waiting'])
        await queue.close()
        return jobs.sort((a, b) => a.data.n - b.data.n)
      }

      const one = await jobsIn('extract-1')
      expect(one.map(j => j.data.n)).to.deep.equal([1, 3])
      expect(one.map(j => j.opts.priority)).to.deep.equal([100, 7])
      expect(one.map(j => j.opts.attempts)).to.deep.equal([1, 1])
      expect(one[1].id).to.equal('three')

      const ten = await jobsIn('extract-10')
      expect(ten.map(j => j.data.n)).to.deep.equal([2])
      expect(ten[0].opts.priority).to.equal(100)
      expect(ten[0].opts.attempts).to.equal(1)

      const load = await jobsIn('load')
      expect(load.map(j => j.name)).to.deep.equal(['thing'])
    })
  })
})
