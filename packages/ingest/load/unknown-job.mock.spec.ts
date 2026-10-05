import { describe, expect, it, vi } from 'vitest'

const { captureMessage, workerMock, captured } = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  workerMock: vi.fn(),
  captured: {} as { handler?: (job: { name: string; id: string; data: unknown }) => Promise<void> }
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
  sentry: { captureMessage },
  strider: {},
  types: {}
}))

import Load from './index'

describe('load worker unknown job guard', () => {
  it('drops an unregistered job name with a sentry warning instead of throwing', async () => {
    const load = new Load()
    await load.up()
    await expect(captured.handler!({ name: 'price', id: '1', data: {} })).resolves.toBeUndefined()
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

  it.each(['new-job', 'toString'])('fails unexpected job %s so its payload is not lost', async name => {
    await new Load().up()
    await expect(captured.handler!({ name, id: '3', data: {} })).rejects.toThrow(`unknown load job ${name}`)
  })
})
