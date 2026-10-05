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
