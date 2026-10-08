import { describe, expect, it, vi } from 'vitest'

const { captureException, captureMessage, workerMock, captured } = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  workerMock: vi.fn(),
  captured: {} as { handler?: (job: { name: string; id: string; queueName?: string; opts?: { removeOnFail?: boolean }; data: unknown }) => Promise<void> }
}))

vi.mock('../db', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  firstRow: vi.fn(),
  getTravelledStrides: vi.fn(),
  toUpsertSql: vi.fn(),
  upsertThingDefaults: vi.fn()
}))

vi.mock('lib', () => ({
  mq: {
    quarantine: vi.fn(async () => undefined),
    q: { load: 'load' },
    job: {
      load: {
        block: { queue: 'load', name: 'block' },
        output: { queue: 'load', name: 'output' },
        monitor: { queue: 'load', name: 'monitor' },
        evmlog: { queue: 'load', name: 'evmlog' },
        snapshot: { queue: 'load', name: 'snapshot' },
        thing: { queue: 'load', name: 'thing' }
      }
    },
    worker: workerMock.mockImplementation((_queue: string, handler: typeof captured.handler) => {
      captured.handler = handler
      return { close: vi.fn() }
    })
  },
  sentry: { captureMessage, captureException },
  strider: {},
  types: {}
}))

import Load from './index'
import { mq } from 'lib'

describe('load worker unknown job guard', () => {
  it('drops an unregistered job name with a sentry warning instead of throwing', async () => {
    const load = new Load()
    await load.up()
    await expect(captured.handler!({ name: 'price', id: '1', data: {} })).resolves.toBeUndefined()
    await captured.handler!({ name: 'price', id: 'legacy-2', data: {} })
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith('unknown load job price', { level: 'warning', tags: { component: 'load' } })
  })

  it('still dispatches registered job names', async () => {
    const load = new Load()
    const monitor = vi.fn(async () => undefined)
    load.handlers.monitor = monitor
    await load.up()
    await captured.handler!({ name: 'monitor', id: '2', data: { ok: true } })
    expect(monitor).toHaveBeenCalledWith({ ok: true })
  })

  it.each(['new-job', 'toString'])('quarantines unexpected job %s before failing', async name => {
    await new Load().up()
    await expect(captured.handler!({ name, id: '3', queueName: 'load', data: {}, opts: {} })).rejects.toThrow(`unknown load job ${name}`)
    expect(mq.quarantine).toHaveBeenCalledWith({ name, id: '3', queueName: 'load', data: {}, opts: {} })
  })
  it('preserves the unknown-job error and separately reports quarantine storage failure', async () => {
    await new Load().up()
    vi.mocked(mq.quarantine).mockRejectedValueOnce(new Error('redis unavailable'))
    const job = { name: 'new-job', id: 'failed-copy', queueName: 'load', data: {}, opts: { removeOnFail: true } }
    await expect(captured.handler!(job)).rejects.toThrow('unknown load job new-job')
    expect(job.opts.removeOnFail).toBe(true)
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: expect.objectContaining({ phase: 'quarantine_write' }) }))
  })
})
