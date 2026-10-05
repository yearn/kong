import { describe, expect, it, vi } from 'vitest'

const { add } = vi.hoisted(() => ({ add: vi.fn(async () => ({})) }))
vi.mock('lib/chains', () => ({ default: [] }))
vi.mock('lib/sentry', () => ({ captureException: vi.fn(), countMetric: vi.fn(), flush: vi.fn() }))
vi.mock('bullmq', async importOriginal => {
  const original = await importOriginal<typeof import('bullmq')>()
  return { ...original, Queue: class {
    constructor(public name: string) {}
    add = add
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
})
