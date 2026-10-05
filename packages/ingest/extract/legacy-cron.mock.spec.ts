import { describe, expect, it, vi } from 'vitest'

const { captured, repeatables, removeRepeatableByKey, close, blockExtract } = vi.hoisted(() => ({
  captured: {} as { handler?: (job: unknown) => Promise<void> },
  repeatables: vi.fn(), removeRepeatableByKey: vi.fn(), close: vi.fn(), blockExtract: vi.fn()
}))

vi.mock('./evmlogs', () => ({ EvmLogsExtractor: class { extract = vi.fn() } }))
vi.mock('./block', () => ({ BlockExtractor: class { extract = blockExtract } }))
vi.mock('./waveydb', () => ({ WaveyDbExtractor: class { extract = vi.fn() } }))
vi.mock('./snapshot', () => ({ SnapshotExtractor: class { extract = vi.fn() } }))
vi.mock('./timeseries', () => ({ TimeseriesExtractor: class { extract = vi.fn() } }))
vi.mock('./manuals', () => ({ ManualsExtractor: class { extract = vi.fn() } }))
vi.mock('./webhook', () => ({ WebhookExtractor: class { extract = vi.fn() } }))

vi.mock('lib', () => ({
  mq: {
    q: { extract: 'extract' },
    job: { extract: Object.fromEntries(['block', 'evmlog', 'waveydb', 'snapshot', 'timeseries', 'manuals', 'webhook'].map(name => [name, { name }])) },
    connect: vi.fn(() => ({ getRepeatableJobs: repeatables, removeRepeatableByKey, close, blockExtract })),
    workers: vi.fn(() => []), worker: vi.fn((_queue, handler) => { captured.handler = handler; return { close: vi.fn() } })
  }
}))

import Extract from './index'
import { mq } from 'lib'

describe('legacy root cron cleanup', () => {
  it('drains already-promoted root jobs without suppressing per-chain block jobs', async () => {
    repeatables.mockResolvedValue([])
    await new Extract().up()
    await expect(captured.handler!({ queueName: 'extract', name: 'block', id: 'legacy', data: {} })).resolves.toBeUndefined()
    expect(blockExtract).not.toHaveBeenCalled()
    await captured.handler!({ queueName: 'extract-1', name: 'block', id: 'modern', data: { chainId: 1 } })
    expect(blockExtract).toHaveBeenCalledExactlyOnceWith({ chainId: 1 })
    vi.clearAllMocks()
  })
  it('removes only root block repeatables before starting workers', async () => {
    repeatables.mockResolvedValue([{ name: 'block', key: 'old-block' }, { name: 'webhook', key: 'keep-webhook' }])
    await new Extract().up()
    expect(mq.connect).toHaveBeenCalledWith('extract')
    expect(removeRepeatableByKey).toHaveBeenCalledExactlyOnceWith('old-block')
    expect(close).toHaveBeenCalledOnce()
    expect(captured.handler).toBeTypeOf('function')
  })
})
