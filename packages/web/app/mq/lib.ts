import { Queue } from 'bullmq'
import { bull } from '../api/mq/bull'
import chains from '@/chains'

// Queue definitions
export const queueNames = [
  'fanout',
  'extract',
  ...chains.map(c => `extract-${c.id}`),
  'load',
  'probe'
]

// Cache queues
const queues: Map<string, Queue> = new Map()

function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, bull))
  }
  return queues.get(name)!
}

export interface QueueStats {
  name: string
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  paused: number
  prioritized: number
  isPaused: boolean
}

export async function getQueueStats(name: string): Promise<QueueStats> {
  const queue = getQueue(name)
  const [counts, isPaused] = await Promise.all([
    queue.getJobCounts(),
    queue.isPaused()
  ])
  return { name, ...counts, isPaused } as QueueStats
}

export async function getAllQueueStats(): Promise<QueueStats[]> {
  return Promise.all(queueNames.map(getQueueStats))
}

export interface JobInfo {
  id: string | undefined
  name: string
  data: Record<string, unknown>
  timestamp: number | undefined
  processedOn: number | undefined
  finishedOn: number | undefined
  attemptsMade: number
  failedReason: string | undefined
  stacktrace: string[] | undefined
  returnvalue: unknown
}

export const validStatuses = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused', 'prioritized'] as const
export type JobStatus = typeof validStatuses[number]

export async function getQueueJobs(name: string, status: JobStatus, start = 0, end = 50): Promise<JobInfo[]> {
  const queue = getQueue(name)
  const jobs = await queue.getJobs([status], start, end)
  return jobs.map(job => ({
    id: job.id,
    name: job.name,
    data: job.data,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    returnvalue: job.returnvalue
  }))
}

export async function getJobById(queueName: string, jobId: string): Promise<JobInfo | null> {
  const queue = getQueue(queueName)
  const job = await queue.getJob(jobId)
  if (!job) return null
  return {
    id: job.id,
    name: job.name,
    data: job.data,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    returnvalue: job.returnvalue
  }
}
