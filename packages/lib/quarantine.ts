import { open } from 'node:fs/promises'
import type { Queue } from 'bullmq'
import { DEFAULT_PRIORITY } from './mq'

// Exclusive creation prevents accidentally overwriting a previous recovery archive.
export function createQuarantineArchive(destination: string) {
  return open(destination, 'wx', 0o600)
}

export async function writeQuarantineRecord(file: { writeFile: (data: string) => Promise<void>, sync: () => Promise<void> }, record: unknown) {
  await file.writeFile(JSON.stringify(record) + '\n')
  await file.sync()
}

// Export a bounded batch. Never remove a payload unless its archive write succeeded.
export async function archiveQuarantine(queue: Pick<Queue, 'getJobs'>, persist: (record: unknown) => Promise<void>, limit = 1000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error('Archive limit must be between 1 and 10000')
  const jobs = await queue.getJobs(['waiting', 'prioritized'], 0, limit - 1, true)
  let archived = 0
  for (const job of jobs) {
    if (!job) continue
    await persist({ quarantineId: job.id, timestamp: job.timestamp, ...job.data })
    await job.remove()
    archived++
  }
  return archived
}

export async function replayQuarantine(record: unknown, publish: (queue: string, name: string, data: unknown, jobId: string) => Promise<unknown>) {
  if (!record || typeof record !== 'object') throw new Error('Invalid quarantine archive record')
  const payload = record as { queue?: unknown, name?: unknown, id?: unknown, data?: unknown }
  if (typeof payload.queue !== 'string' || !/^(fanout|load|probe|extract(?:-\d+)?)$/.test(payload.queue)
    || typeof payload.name !== 'string' || !payload.name || typeof payload.id !== 'string' || !payload.id || !('data' in payload)) {
    throw new Error('Invalid original queue, name, id or data in quarantine archive')
  }
  const jobId = `quarantine-replay-${Buffer.from(JSON.stringify([payload.queue, payload.id])).toString('base64url')}`
  return publish(payload.queue, payload.name, payload.data, jobId)
}

export async function publishReplay(
  queue: { getJob: (jobId: string) => Promise<unknown>, add: (name: string, data: unknown, opts: { jobId: string, priority: number, attempts: number }) => Promise<unknown> },
  jobName: string,
  data: unknown,
  jobId: string,
  priority = DEFAULT_PRIORITY
) {
  if (await queue.getJob(jobId)) return false
  await queue.add(jobName, data, { jobId, priority, attempts: 1 })
  return true
}
