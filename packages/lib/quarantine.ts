import type { Queue } from 'bullmq'

// Export a bounded batch. Never remove a payload unless its archive write succeeded.
export async function archiveQuarantine(queue: Pick<Queue, 'getJobs'>, persist: (record: unknown) => Promise<void>, limit = 1000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error('Archive limit must be between 1 and 10000')
  const jobs = await queue.getJobs(['waiting', 'prioritized'], 0, limit - 1, true)
  let archived = 0
  for (const job of jobs) {
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
