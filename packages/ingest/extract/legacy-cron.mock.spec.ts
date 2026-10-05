import { describe, expect, it, vi } from 'vitest'

const { captured, repeatables, removeRepeatableByKey, close } = vi.hoisted(() => ({
  captured: {} as { handler?: (job: unknown) => Promise<void> },
  repeatables: vi.fn(), removeRepeatableByKey: vi.fn(), close: vi.fn()
}))

vi.mock('./evmlogs', () => ({ EvmLogsExtractor: class { extract = vi.fn() } }))
vi.mock('./block', () => ({ BlockExtractor: class { extract = vi.fn() } }))
vi.mock('./waveydb', () => ({ WaveyDbExtractor: class { extract = vi.fn() } }))
vi.mock('./snapshot', () => ({ SnapshotExtractor: class { extract = vi.fn() } }))
vi.mock('./timeseries', () => ({ TimeseriesExtractor: class { extract = vi.fn() } }))
vi.mock('./manuals', () => ({ ManualsExtractor: class { extract = vi.fn() } }))
vi.mock('./webhook', () => ({ WebhookExtractor: class { extract = vi.fn() } }))

vi.mock('lib', () => ({
  mq: {
    q: { extract: 'extract' },
    job: { extract: Object.fromEntries(['block', 'evmlog', 'waveydb', 'snapshot', 'timeseries', 'manuals', 'webhook'].map(name => [name, { name }])) },
    connect: vi.fn(() => ({ getRepeatableJobs: repeatables, removeRepeatableByKey, close })),
    workers: vi.fn(() => []), worker: vi.fn((_queue, handler) => { captured.handler = handler; return { close: vi.fn() } })
  }
}))

import Extract from './index'
import { mq } from 'lib'

describe('legacy root cron cleanup', () => {
  it('removes only root block repeatables before starting workers', async () => {
    repeatables.mockResolvedValue([{ name: 'block', key: 'old-block' }, { name: 'webhook', key: 'keep-webhook' }])
    await new Extract().up()
    expect(mq.connect).toHaveBeenCalledWith('extract')
    expect(removeRepeatableByKey).toHaveBeenCalledExactlyOnceWith('old-block')
    expect(close).toHaveBeenCalledOnce()
    expect(captured.handler).toBeTypeOf('function')
  })
})
