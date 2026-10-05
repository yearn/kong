import { describe, expect, it, vi } from 'vitest'
import { archiveQuarantine, replayQuarantine } from 'lib/quarantine'

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
  it('replays original payloads with stable IDs distinct from failed originals', async () => {
    const publish = vi.fn(async () => undefined)
    const record = { queue: 'extract-1', name: 'fixed-job', id: '42', data: { chainId: 1 } }
    await replayQuarantine(record, publish)
    await replayQuarantine(record, publish)
    expect(publish).toHaveBeenCalledWith('extract-1', 'fixed-job', record.data,
      `quarantine-replay-${Buffer.from(JSON.stringify(['extract-1', '42'])).toString('base64url')}`)
    expect(publish.mock.calls[0]).toEqual(publish.mock.calls[1])
  })
})
