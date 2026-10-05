import { afterEach, describe, expect, it, vi } from 'vitest'

const { add, progress } = vi.hoisted(() => ({ add: vi.fn(async (..._args: unknown[]) => undefined), progress: vi.fn(async () => 150n) }))
vi.mock('lib', async importOriginal => ({
  ...await importOriginal<typeof import('lib')>(),
  mq: { add, job: { extract: { evmlog: {} } } }
}))
vi.mock('lib/blocks', () => ({ estimateHeight: vi.fn(), getBlockNumber: async () => 200n }))
vi.mock('../db', () => ({ getTravelledStrides: async () => undefined }))
vi.mock('../envio', async importOriginal => ({
  ...await importOriginal<typeof import('../envio')>(), envioProgressBlock: progress
}))
import EventsFanout from './events'
import { isEnvioSourceCovered } from '../envio'

const address = '0x0000000000000000000000000000000000000002'
const job = { abi: { abiPath: 'yearn/2/vault' }, source: { chainId: 1, address, inceptBlock: 1n } }

describe('Envio-independent fanout progress', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
  it('plans through RPC head when confirmed coverage starts after inception', async () => {
    vi.stubEnv('USE_ENVIO', 'true')
    vi.stubEnv('ENVIO_CHAINS', '1')
    vi.stubEnv('LOG_STRIDE', '50')
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([{ chainId: 1, address, abiPath: 'yearn/2/vault', fromBlock: '100' }]))
    await new EventsFanout().fanout(job as never)
    const jobs = add.mock.calls.map(call => call[1] as { from: bigint, to: bigint })
    expect(jobs).toHaveLength(4)
    expect(jobs.at(-1)?.to).toBe(200n)
    expect(progress).not.toHaveBeenCalled()
    expect(isEnvioSourceCovered(1, address, 'yearn/2/vault', jobs[0].from)).toBe(false)
    expect(isEnvioSourceCovered(1, address, 'yearn/2/vault', jobs[2].from)).toBe(true)
  })
  it('uses the full RPC range when metadata is unavailable', async () => {
    vi.stubEnv('USE_ENVIO', 'true')
    vi.stubEnv('ENVIO_CHAINS', '1')
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([{ chainId: 1, address, abiPath: 'yearn/2/vault', fromBlock: '1' }]))
    progress.mockRejectedValueOnce(new Error('metadata unavailable'))
    await new EventsFanout().fanout(job as never)
    expect(add.mock.calls.at(-1)?.[1]).toMatchObject({ to: 200n })
  })
  it('keeps enqueuing RPC ranges beyond a lagging watermark', async () => {
    vi.stubEnv('USE_ENVIO', 'true')
    vi.stubEnv('ENVIO_CHAINS', '1')
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([{ chainId: 1, address, abiPath: 'yearn/2/vault', fromBlock: '100' }]))
    await new EventsFanout().fanout({ ...job, source: { ...job.source, startBlock: 151n } } as never)
    expect(add.mock.calls.at(-1)?.[1]).toMatchObject({ from: 151n, to: 200n })
  })
})
