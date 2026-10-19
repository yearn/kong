import { afterEach, describe, expect, it, vi } from 'vitest'

const { submit } = vi.hoisted(() => ({
  submit: vi.fn<(name: string, jobs: unknown[]) => Promise<unknown[]>>(async () => [])
}))
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(public name: string) {}
    addBulk(jobs: unknown[]) { return submit(this.name, jobs) }
    close = vi.fn()
  },
  Worker: class {}
}))
vi.mock('../lib/chains', () => ({ default: [] }))
vi.mock('../lib/sentry', () => ({ captureException: vi.fn(), countMetric: vi.fn(), flush: vi.fn() }))

import { addBulk, down, job } from '../lib/mq'

afterEach(async () => {
  await down()
  submit.mockReset()
})

describe('streamed bulk enqueueing', () => {
  it('submits bounded batches before producing more jobs and discards returned instances', async () => {
    let produced = 0
    let submitted = 0
    submit.mockImplementation(async (_queue, jobs) => {
      expect(jobs.length).toBeLessThanOrEqual(1000)
      expect(produced).toBe(submitted + jobs.length)
      submitted += jobs.length
      return jobs
    })
    function* jobs() {
      for (let n = 0; n < 2501; n++) {
        produced++
        yield { job: job.load.thing, data: { n } }
      }
    }
    expect(await addBulk(jobs())).toBeUndefined()
    expect(submitted).toBe(2501)
    expect(submit.mock.calls.map(([, jobs]) => jobs.length)).toEqual([1000, 1000, 501])
  })

  it('stops producing jobs when a batch fails', async () => {
    let produced = 0
    const failure = new Error('Redis unavailable')
    submit.mockRejectedValue(failure)
    function* jobs() {
      for (let n = 0; n < 2501; n++) {
        produced++
        yield { job: job.load.thing, data: { n } }
      }
    }
    await expect(addBulk(jobs())).rejects.toBe(failure)
    expect(produced).toBe(1000)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('waits for sibling queue submissions before reporting a failure', async () => {
    const failure = new Error('load failed')
    let release!: () => void
    submit.mockImplementation(async queue => {
      if (queue === 'load') throw failure
      await new Promise<void>(resolve => { release = resolve })
      return []
    })
    let settled = false
    const pending = addBulk([
      { job: job.load.thing, data: {} },
      { job: job.extract.evmlog, data: { chainId: 1 } }
    ]).finally(() => { settled = true })
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(settled).toBe(false)
    release()
    await expect(pending).rejects.toBe(failure)
  })
})
