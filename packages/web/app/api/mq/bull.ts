import { Queue } from 'bullmq'

export const bull = { connection: {
  host: process.env.BULLMQ_REDIS_HOST || 'localhost',
  port: (process.env.BULLMQ_REDIS_PORT || 6379) as number,
  username: process.env.BULLMQ_REDIS_USERNAME || undefined,
  password: process.env.BULLMQ_REDIS_PASSWORD || undefined
}}

export function getQueue(queues: Record<string, Queue>, q: string) {
  if (!queues[q]) { queues[q] = new Queue(q, bull) }
  return queues[q]
}
