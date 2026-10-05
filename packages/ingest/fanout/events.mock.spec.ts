import { beforeEach, describe, expect, it, vi } from 'vitest'
const { add, reserve, finish, travelled } = vi.hoisted(() => ({ add: vi.fn(), reserve: vi.fn(), finish: vi.fn(), travelled: vi.fn() }))
vi.mock('lib', async () => ({
  mq: { add, reserveDiscoveryRepair: reserve, finishDiscoveryRepair: finish, job: { extract: { evmlog: {} } } }, strider: await vi.importActual('lib/strider')
}))
vi.mock('lib/blocks', () => ({ estimateHeight: vi.fn(), getBlockNumber: async () => 100n }))
vi.mock('../db', () => ({ getTravelledStrides: travelled }))
import EventsFanout from './events'
const job = { abi: { abiPath: 'yearn/3/vault' }, source: { chainId: 1, address: '0x01', inceptBlock: 1n } }

describe('event discovery repair fanout', () => {
  beforeEach(() => { vi.clearAllMocks(); reserve.mockResolvedValue({ status: 'granted', token: 'lease' }); travelled.mockResolvedValue([{ from: 1n, to: 100n }]) })
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
  it('defers full-history repair when the shared budget is exhausted', async () => {
    reserve.mockResolvedValue({ status: 'budget', token: 'unused' })
    await new EventsFanout().fanout({ ...job, ignoreStrides: true, discoveryRepair: true } as never)
    expect(add).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
  })
  it('records successful admission independently of completed job retention', async () => {
    await new EventsFanout().fanout({ ...job, ignoreStrides: true, discoveryRepair: true } as never)
    expect(finish).toHaveBeenCalledWith(1, '0x01', 'lease', true)
  })
  it('releases the vault lease after failed fanout', async () => {
    add.mockRejectedValueOnce(new Error('RPC unavailable'))
    await expect(new EventsFanout().fanout({ ...job, ignoreStrides: true, discoveryRepair: true } as never)).rejects.toThrow('RPC unavailable')
    expect(finish).toHaveBeenCalledWith(1, '0x01', 'lease', false)
  })
})
