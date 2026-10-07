import { expect } from 'chai'
import { chains, mq } from 'lib'
import { findBusyMatch } from './isBusy'

const names = [mq.q.fanout, mq.q.extract, mq.q.load, ...chains.map(chain => `${mq.q.extract}-${chain.id}`)]

async function clean() {
  for (const name of names) {
    const queue = mq.connect(name)
    await queue.obliterate({ force: true })
    await queue.close()
  }
}

describe('fanout/isBusy', () => {
  beforeEach(clean)
  afterEach(clean)
  afterAll(() => mq.down())

  it('is idle with nothing queued', async () => {
    expect(await findBusyMatch()).to.equal(null)
  })

  it('detects a prioritized waiting job', async () => {
    await mq.add(mq.job.load.evmlog, { batch: [] })
    expect(await findBusyMatch()).to.deep.equal({ queue: 'load', jobName: 'evmlog', status: 'prioritized' })
  })

  it('ignores a queued load.monitor', async () => {
    await mq.add(mq.job.load.monitor, {})
    expect(await findBusyMatch()).to.equal(null)
  })
})
