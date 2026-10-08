import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRIORITY } from 'lib/mq'
import { archiveQuarantine, createQuarantineArchive, publishReplay, replayQuarantine, writeQuarantineRecord } from 'lib/quarantine'

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

  it('rejects a limit outside 1..10000 before listing jobs', async () => {
    const getJobs = vi.fn()
    await expect(archiveQuarantine({ getJobs } as never, async () => undefined, 0)).rejects.toThrow('Archive limit')
    await expect(archiveQuarantine({ getJobs } as never, async () => undefined, 10_001)).rejects.toThrow('Archive limit')
    expect(getJobs).not.toHaveBeenCalled()
  })

  it('skips a missing job and still archives the rest', async () => {
    const remove = vi.fn()
    const seen: unknown[] = []
    const count = await archiveQuarantine({
      getJobs: async () => [undefined, { id: '7', timestamp: 1, data: { queue: 'load', name: 'n', id: '7', data: null }, remove }]
    } as never, async record => { seen.push(record) })
    expect(count).toBe(1)
    expect(seen).toEqual([{ quarantineId: '7', timestamp: 1, queue: 'load', name: 'n', id: '7', data: null }])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('rejects an archive record aimed at a non-ingest queue', async () => {
    const publish = vi.fn()
    await expect(replayQuarantine({ queue: 'quarantine', name: 'n', id: '1', data: {} }, publish)).rejects.toThrow('Invalid original queue')
    expect(publish).not.toHaveBeenCalled()
  })

  it('rejects an archive record with no data field and accepts null data', async () => {
    const publish = vi.fn(async () => undefined)
    await expect(replayQuarantine({ queue: 'load', name: 'n', id: '1' }, publish)).rejects.toThrow('Invalid original queue')
    await replayQuarantine({ queue: 'load', name: 'n', id: '1', data: null }, publish)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith('load', 'n', null, expect.any(String))
  })

  it('does not enqueue a replay id that is already present', async () => {
    const add = vi.fn()
    await expect(publishReplay({ getJob: async () => ({ id: 'x' }), add }, 'fixed-job', { a: 1 }, 'jid')).resolves.toBe(false)
    expect(add).not.toHaveBeenCalled()
  })

  it('enqueues a missing replay id at the default priority', async () => {
    const add = vi.fn(async () => undefined)
    await expect(publishReplay({ getJob: async () => undefined, add }, 'fixed-job', { a: 1 }, 'jid')).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith('fixed-job', { a: 1 }, { jobId: 'jid', priority: DEFAULT_PRIORITY, attempts: 1 })
  })

  it('syncs the jsonl line before returning', async () => {
    const operations: string[] = []
    const record = { queue: 'load', id: '1', name: 'n', data: null }
    await writeQuarantineRecord({
      writeFile: async data => { operations.push(data) },
      sync: async () => { operations.push('sync') }
    }, record)
    expect(operations).toEqual([JSON.stringify(record) + '\n', 'sync'])
  })

  it('creates a private archive and refuses to overwrite it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kong-quarantine-'))
    try {
      const dest = join(dir, 'archive.jsonl')
      const file = await createQuarantineArchive(dest)
      expect((await file.stat()).mode & 0o777).toBe(0o600)
      await file.close()
      await expect(createQuarantineArchive(dest)).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
