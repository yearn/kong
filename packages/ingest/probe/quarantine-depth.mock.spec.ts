import { describe, expect, it, vi } from 'vitest'
const { add, getJobCounts, captureMessage } = vi.hoisted(() => ({
  add: vi.fn(), getJobCounts: vi.fn(), captureMessage: vi.fn()
}))
vi.mock('lib/chains', () => ({ default: [] }))
vi.mock('lib/sentry', () => ({ captureException: vi.fn(), countMetric: vi.fn(), captureMessage, flush: vi.fn() }))
vi.mock('../db', () => ({ default: {} }))
vi.mock('bullmq', async importOriginal => ({
  ...await importOriginal<typeof import('bullmq')>(),
  Queue: class {
    constructor(public name: string) {}
    add = add
    getJobCounts = getJobCounts
    close = vi.fn()
  }
}))
import { quarantine } from 'lib/mq'
import Probe from './index'

describe('quarantine backlog probe', () => {
  it('alerts for the prioritized state produced by quarantine admission', async () => {
    let prioritized = 0
    add.mockImplementation(async (_name, _data, opts) => { if (opts.priority) prioritized++; return {} })
    getJobCounts.mockImplementation(async () => ({ waiting: 0, prioritized }))
    await quarantine({ queueName: 'extract', id: '99', name: 'unknown', data: null })
    const probe = new Probe() as unknown as { queues: object, probeQueues: () => Promise<unknown> }
    probe.queues = { quarantine: {
      name: 'quarantine', getJobCounts, getJobs: async () => [], client: Promise.resolve({ info: async () => '' })
    } }
    await probe.probeQueues()
    expect(getJobCounts).toHaveBeenCalledWith('waiting', 'prioritized')
    expect(captureMessage).toHaveBeenCalledWith('QUARANTINE_BACKLOG', expect.objectContaining({ extra: expect.objectContaining({ depth: 1 }) }))
  })
})
