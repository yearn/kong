import { describe, expect, it, vi } from 'vitest'

const { captureMessage, captured, snapshotExtract } = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captured: {} as { handler?: (job: { name: string; id: string; data: Record<string, unknown> | null }) => Promise<void> },
  snapshotExtract: vi.fn(async () => undefined)
}))

vi.mock('./evmlogs', () => ({ EvmLogsExtractor: class { extract = vi.fn() } }))
vi.mock('./block', () => ({ BlockExtractor: class { extract = vi.fn() } }))
vi.mock('./snapshot', () => ({ SnapshotExtractor: class { extract = snapshotExtract } }))
vi.mock('./timeseries', () => ({ TimeseriesExtractor: class { extract = vi.fn() } }))
vi.mock('./manuals', () => ({ ManualsExtractor: class { extract = vi.fn() } }))
vi.mock('./webhook', () => ({ WebhookExtractor: class { extract = vi.fn() } }))

vi.mock('lib', () => ({
  mq: {
    q: { extract: 'extract' },
    job: {
      extract: {
        block: { queue: 'extract', name: 'block', bychain: true },
        evmlog: { queue: 'extract', name: 'evmlog', bychain: true },
        snapshot: { queue: 'extract', name: 'snapshot', bychain: true },
        timeseries: { queue: 'extract', name: 'timeseries', bychain: true },
        manuals: { queue: 'extract', name: 'manuals' },
        webhook: { queue: 'extract', name: 'webhook' }
      }
    },
    workers: vi.fn(() => []),
    worker: vi.fn((_queue: string, handler: typeof captured.handler) => {
      captured.handler = handler
      return { close: vi.fn() }
    })
  },
  sentry: { captureMessage }
}))

import Extract from './index'

describe('extract worker unknown job guard', () => {
  it('drains retired jobs and reports a warning once per name', async () => {
    await new Extract().up()
    await expect(captured.handler!({ name: 'waveydb', id: '1', data: { chainId: 1 } })).resolves.toBeUndefined()
    await captured.handler!({ name: 'waveydb', id: 'legacy-2', data: {} })
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith('retired extract job waveydb', { level: 'warning', tags: { component: 'extract' } })
  })

  it('still dispatches registered job names', async () => {
    await new Extract().up()
    await captured.handler!({ name: 'snapshot', id: '2', data: { chainId: 1 } })
    expect(snapshotExtract).toHaveBeenCalledWith({ chainId: 1 })
  })

  it.each(['new-job', 'toString'])('fails unexpected job %s', async name => {
    await new Extract().up()
    await expect(captured.handler!({ name, id: '3', data: {} })).rejects.toThrow(`unknown extract job ${name}`)
  })

  it('rejects an unknown name before reading a null payload', async () => {
    await new Extract().up()
    await expect(captured.handler!({ name: 'unexpected-null', id: 'null', data: null })).rejects.toThrow('unknown extract job unexpected-null')
  })
})
