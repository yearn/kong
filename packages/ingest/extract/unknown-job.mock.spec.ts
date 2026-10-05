import { describe, expect, it, vi } from 'vitest'

const { captureException, captureMessage, captured, snapshotExtract } = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  captured: {} as { handler?: (job: { name: string; id: string; queueName?: string; opts?: { removeOnFail?: boolean }; data: Record<string, unknown> }) => Promise<void> },
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
    quarantine: vi.fn(async () => undefined),
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
  sentry: { captureMessage, captureException }
}))

import Extract from './index'
import { mq } from 'lib'

describe('extract worker unknown job guard', () => {
  it('drops an unregistered job name with a sentry warning instead of throwing', async () => {
    await new Extract().up()
    await expect(captured.handler!({ name: 'waveydb', id: '1', data: { chainId: 1 } })).resolves.toBeUndefined()
    await captured.handler!({ name: 'waveydb', id: 'legacy-2', data: {} })
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith('unknown extract job waveydb', { level: 'warning', tags: { component: 'extract' } })
  })

  it('still dispatches registered job names', async () => {
    await new Extract().up()
    await captured.handler!({ name: 'snapshot', id: '2', data: { chainId: 1 } })
    expect(snapshotExtract).toHaveBeenCalledWith({ chainId: 1 })
  })

  it.each(['new-job', 'toString'])('quarantines unexpected job %s before failing', async name => {
    await new Extract().up()
    await expect(captured.handler!({ name, id: '3', queueName: 'extract-1', data: {}, opts: {} })).rejects.toThrow(`unknown extract job ${name}`)
    expect(mq.quarantine).toHaveBeenCalledWith({ name, id: '3', queueName: 'extract-1', data: {}, opts: {} })
  })
  it('preserves the unknown-job error and separately reports quarantine storage failure', async () => {
    await new Extract().up()
    vi.mocked(mq.quarantine).mockRejectedValueOnce(new Error('redis unavailable'))
    const job = { name: 'new-job', id: 'failed-copy', queueName: 'extract-1', data: {}, opts: { removeOnFail: true } }
    await expect(captured.handler!(job)).rejects.toThrow('unknown extract job new-job')
    expect(job.opts.removeOnFail).toBe(true)
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: expect.objectContaining({ phase: 'quarantine_write' }) }))
  })
})
