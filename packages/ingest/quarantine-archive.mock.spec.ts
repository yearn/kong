import { describe, expect, it, vi } from 'vitest'
import { archiveQuarantine } from 'lib/quarantine'

describe('quarantine archive-and-drain', () => {
  it('archives a bounded batch before removing each payload', async () => {
    const operations: string[] = []
    const job = { id: '42', timestamp: 100, data: { queue: 'load', name: 'unknown', data: { value: 1 } }, remove: vi.fn(async () => { operations.push('remove') }) }
    const getJobs = vi.fn(async () => [job])
    const count = await archiveQuarantine({ getJobs } as never, async record => {
      expect(record).toEqual({ quarantineId: '42', timestamp: 100, ...job.data })
      operations.push('sync')
    })
    expect(getJobs).toHaveBeenCalledWith(['waiting', 'prioritized'], 0, 999, true)
    expect(operations).toEqual(['sync', 'remove'])
    expect(count).toBe(1)
  })
  it('retains the Redis payload when archiving fails', async () => {
    const remove = vi.fn()
    await expect(archiveQuarantine({ getJobs: async () => [{ id: '42', data: {}, remove }] } as never,
      async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(remove).not.toHaveBeenCalled()
  })
})
