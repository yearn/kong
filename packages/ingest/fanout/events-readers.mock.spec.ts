import { describe, expect, it, vi } from 'vitest'
const { add, coverage } = vi.hoisted(() => ({ add: vi.fn(), coverage: vi.fn() }))
vi.mock('lib', async importOriginal => ({ ...await importOriginal<object>(), mq: { add, job: { extract: { evmlog: {} } } } }))
vi.mock('../db', () => ({ getTravelledStrides: coverage }))
vi.mock('lib/blocks', () => ({ estimateHeight: vi.fn(), getBlockNumber: vi.fn(async () => 200n) }))
import EventsFanout from './events'

describe('reader fanout', () => {
  it('uses independent coverage and job IDs for matching address ranges', async () => {
    coverage.mockResolvedValue(undefined)
    const fanout = new EventsFanout()
    const source = { chainId: 1, address: '0x0000000000000000000000000000000000000483' as const, inceptBlock: 100n, skip: false, only: false }
    for (const abiPath of ['erc4626', 'yearn/3/vault']) await fanout.fanout({ source, abi: { abiPath, sources: [], skip: false, only: false } })
    expect(coverage.mock.calls.map(call => call[2])).toEqual(['erc4626', 'yearn/3/vault'])
    const ids = add.mock.calls.map(call => call[2].jobId)
    expect(new Set(ids).size).toBe(2)
    expect(add.mock.calls.map(call => call[1].abiPath)).toEqual(['erc4626', 'yearn/3/vault'])
  })
})
