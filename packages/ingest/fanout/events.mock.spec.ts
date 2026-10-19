import { describe, expect, it, vi } from 'vitest'
import type { BulkJob } from 'lib/mq'

const { addBulk } = vi.hoisted(() => ({ addBulk: vi.fn<(jobs: Iterable<BulkJob>) => Promise<void>>() }))
vi.mock('lib', async () => ({
  strider: await import('lib/strider'),
  mq: { addBulk, job: { extract: { evmlog: { name: 'evmlog', queue: 'extract', bychain: true } } } }
}))
vi.mock('lib/blocks', () => ({ estimateHeight: vi.fn(), getBlockNumber: vi.fn() }))
vi.mock('../db', () => ({ getTravelledStrides: vi.fn() }))

import EventsFanout from './events'
import { AbiConfigSchema, SourceConfigSchema } from 'lib/abis'

describe('event fanout streaming', () => {
  it('lazily produces a large replay with the same ranges and job IDs', async () => {
    let count = 0
    let last: BulkJob | undefined
    addBulk.mockImplementation(async jobs => {
      expect(Array.isArray(jobs)).toBe(false)
      for (const job of jobs) {
        if (count === 0) expect(job.options.jobId).toBe('evmlog-1-0xabc-1-10000')
        count++
        last = job
      }
    })
    await new EventsFanout().fanout({
      abi: AbiConfigSchema.parse({ abiPath: 'x' }),
      source: SourceConfigSchema.parse({ chainId: 1, address: '0xabc', inceptBlock: 1n, endBlock: 25_000_001n }),
      replay: { enabled: true }
    })
    expect(count).toBe(2501)
    expect(last?.data).toMatchObject({ from: 25_000_001n, to: 25_000_001n, replay: true })
    expect(last?.options.jobId).toBe('evmlog-1-0xabc-25000001-25000001')
  })
})
