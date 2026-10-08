import { describe, expect, it, vi } from 'vitest'

const { add, count, getJobs } = vi.hoisted(() => ({ add: vi.fn(async () => ({})), count: vi.fn(async () => 0), getJobs: vi.fn(async () => [] as { remove: () => void }[]) }))
vi.mock('lib/chains', () => ({ default: [] }))
vi.mock('lib/sentry', () => ({ captureException: vi.fn(), countMetric: vi.fn(), flush: vi.fn() }))
vi.mock('bullmq', async importOriginal => {
  const original = await importOriginal<typeof import('bullmq')>()
  return { ...original, Queue: class {
    constructor(public name: string) {}
    add = add
    count = count
    getJobs = getJobs
    close = vi.fn()
  } }
})

import { Job } from 'bullmq'
import { quarantine } from 'lib/mq'

describe('durable quarantine in the CI mocks project', () => {
  it('preserves BullMQ originating queues and separates same-id payloads', async () => {
    const originalJob = (name: string) => new Job({ name, qualifiedName: `bull:${name}`, keys: { wait: `bull:${name}:wait`, paused: `bull:${name}:paused`, meta: `bull:${name}:meta` }, toKey: (key: string) => `bull:${name}:${key}` } as never,
      'unexpected', { payload: name }, {}, '42')
    await quarantine(originalJob('extract-1'))
    await quarantine(originalJob('load'))
    const calls = add.mock.calls as unknown as [string, { queue: string, id: string, data: unknown }, { jobId: string, removeOnComplete: boolean, removeOnFail: boolean }][]
    expect(calls).toHaveLength(2)
    expect(add.mock.contexts[0]).toHaveProperty('name', 'quarantine')
    expect(add.mock.contexts[1]).toHaveProperty('name', 'quarantine')
    for (const [index, queue] of ['extract-1', 'load'].entries()) {
      expect(calls[index]).toEqual(['unexpected', { queue, id: '42', name: 'unexpected', data: { payload: queue } }, expect.objectContaining({
        jobId: Buffer.from(JSON.stringify([queue, '42'])).toString('base64url'), removeOnComplete: false, removeOnFail: false
      })])
    }
    expect(calls[0][2].jobId).not.toEqual(calls[1][2].jobId)
  })

  it('drops the oldest jobs beyond the cap', async () => {
    const remove = vi.fn()
    count.mockResolvedValueOnce(10_002)
    getJobs.mockResolvedValueOnce([{ remove }, { remove }])
    await quarantine({ queueName: 'load', id: '9', name: 'x', data: {} })
    expect(getJobs).toHaveBeenCalledWith(['waiting', 'prioritized'], 0, 1, true)
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('skips a trim slot whose job hash is already gone', async () => {
    const remove = vi.fn()
    count.mockResolvedValueOnce(10_001)
    getJobs.mockResolvedValueOnce([undefined, { remove }])
    await quarantine({ queueName: 'load', id: '9', name: 'x', data: {} })
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('refuses a job that has no queue or id', async () => {
    add.mockClear()
    await expect(quarantine({ queueName: '', id: '1', name: 'x', data: {} })).rejects.toThrow('originating queue')
    await expect(quarantine({ queueName: 'load', name: 'x', data: {} })).rejects.toThrow('without an ID')
    expect(add).not.toHaveBeenCalled()
  })
})
