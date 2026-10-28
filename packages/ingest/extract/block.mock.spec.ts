import { beforeEach, describe, expect, it, vi } from 'vitest'
const { next, add, blocks } = vi.hoisted(() => ({ next: vi.fn(), add: vi.fn(), blocks: {} }))
vi.mock('lib', () => ({ chains: [{ id: 1 }, { id: 137 }], mq: { add, job: { load: { block: 'block' } } } }))
vi.mock('../rpcs', () => ({ latestBlocks: blocks, rpcs: { next } }))
import { BlockExtractor } from './block'

beforeEach(() => {
  vi.clearAllMocks()
  next.mockImplementation(chainId => ({ chain: { id: chainId }, getBlock: async () => ({ number: 123n, timestamp: 456n }) }))
})
describe('block polling scope', () => {
  it('polls each chain exactly once across a per-chain cron cycle', async () => {
    const extractor = new BlockExtractor()
    await extractor.extract({ chainId: 1 })
    await extractor.extract({ chainId: 137 })
    expect(next.mock.calls).toEqual([[1], [137]])
    expect(add).toHaveBeenCalledTimes(2)
    expect(add).toHaveBeenCalledWith('block', { chainId: 137, blockNumber: 123n, blockTime: 456n }, { jobId: '137-123' })
    expect(blocks).toHaveProperty('137', { blockNumber: 123n, blockTime: 456n, observedAt: expect.any(Number) })
  })
  it('supports queued legacy jobs without a chain', async () => {
    await new BlockExtractor().extract()
    expect(next.mock.calls).toEqual([[1], [137]])
  })
  it('fails unknown chains without making requests', async () => {
    await expect(new BlockExtractor().extract({ chainId: 999 })).rejects.toThrow('Unknown block job chain')
    expect(next).not.toHaveBeenCalled()
  })
  it('propagates provider failure so a failed poll is not persisted', async () => {
    next.mockReturnValue({ getBlock: async () => { throw new Error('offline') } })
    await expect(new BlockExtractor().extract({ chainId: 1 })).rejects.toThrow('offline')
    expect(add).not.toHaveBeenCalled()
  })
})
