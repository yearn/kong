import { beforeEach, describe, expect, it, vi } from 'vitest'
const { next, getBlock, add, latestBlocks } = vi.hoisted(() => ({
  next: vi.fn(), getBlock: vi.fn(), add: vi.fn(), latestBlocks: {} as Record<number, unknown>
}))
vi.mock('lib', () => ({ mq: { add, job: { load: { block: {} } } } }))
vi.mock('../rpcs', () => ({ rpcs: { next }, latestBlocks }))
import { BlockExtractor } from './block'
describe('per-chain block extraction', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects missing chainId before selecting an RPC', async () => {
    await expect(new BlockExtractor().extract({})).rejects.toThrow('chainId')
    expect(next).not.toHaveBeenCalled()
  })
  it('fetches exactly the requested chain once', async () => {
    next.mockReturnValue({ chain: { id: 1 }, getBlock })
    getBlock.mockResolvedValue({ number: 100n, timestamp: 200n })
    await new BlockExtractor().extract({ chainId: 1 })
    expect(next).toHaveBeenCalledExactlyOnceWith(1)
    expect(getBlock).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledWith(expect.anything(), { chainId: 1, blockNumber: 100n, blockTime: 200n }, { jobId: '1-100' })
  })
})
