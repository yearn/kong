import { beforeEach, describe, expect, it, vi } from 'vitest'
const { add, travelled } = vi.hoisted(() => ({ add: vi.fn(), travelled: vi.fn() }))
vi.mock('lib', async () => ({
  mq: { add, job: { extract: { evmlog: {} } } }, strider: await vi.importActual('lib/strider')
}))
vi.mock('lib/blocks', () => ({ estimateHeight: vi.fn(), getBlockNumber: async () => 100n }))
vi.mock('../db', () => ({ getTravelledStrides: travelled }))
import EventsFanout from './events'
const job = { abi: { abiPath: 'yearn/3/vault' }, source: { chainId: 1, address: '0x01', inceptBlock: 1n } }

describe('event discovery repair fanout', () => {
  beforeEach(() => { vi.clearAllMocks(); travelled.mockResolvedValue([{ from: 1n, to: 100n }]) })
  it('normally skips covered history', async () => {
    await new EventsFanout().fanout(job as never)
    expect(add).not.toHaveBeenCalled()
  })
  it('refetches full history with an ABI-specific job ID when forced', async () => {
    await new EventsFanout().fanout({ ...job, ignoreStrides: true } as never)
    expect(travelled).not.toHaveBeenCalled()
    expect(add).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ from: 1n, to: 100n }),
      { jobId: 'evmlog-yearn/3/vault-1-0x01-1-100' })
  })
})
