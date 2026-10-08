import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { metric, queued } = vi.hoisted(() => ({ metric: vi.fn(), queued: vi.fn() }))
vi.mock('lib/chains', () => ({ default: [] }))
vi.mock('lib/sentry', () => ({ captureException: vi.fn(), countMetric: metric, flush: vi.fn() }))
vi.mock('bullmq', () => ({ Queue: class { add = queued }, Worker: class {} }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('MQ_INVENTORY', 'true') })
afterEach(() => vi.unstubAllEnvs())

describe('multi-reader job inventory', () => {
  it('preserves address and ABI attribution for grouped fanout and selector extraction', async () => {
    const mq = await import('lib/mq')
    const address = '0x0000000000000000000000000000000000000001'
    const paths = ['erc4626', 'yearn/3/vault']
    await mq.add(mq.job.fanout.events, { chainId: 1, readers: paths.map(abiPath => ({ abi: { abiPath }, source: { chainId: 1, address } })) })
    await mq.add(mq.job.extract.evmlog, { chainId: 1, address, abiPaths: paths, from: 1n, to: 10n })
    expect(metric).toHaveBeenNthCalledWith(1, 'mq.job_added', 1, expect.objectContaining({ address, abiPath: 'erc4626,yearn/3/vault', queue: 'fanout' }))
    expect(metric).toHaveBeenNthCalledWith(2, 'mq.job_added', 1, expect.objectContaining({ address, abiPath: 'erc4626,yearn/3/vault', queue: 'extract-1' }))
  })
})
