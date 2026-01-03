import { Queue } from 'bullmq'

export const bull = { connection: {
  host: process.env.BULLMQ_REDIS_HOST || 'localhost',
  port: (process.env.BULLMQ_REDIS_PORT || 6379) as number,
  ...(process.env.BULLMQ_REDIS_USERNAME ? { username: process.env.BULLMQ_REDIS_USERNAME } : {}),
  ...(process.env.BULLMQ_REDIS_PASSWORD ? { password: process.env.BULLMQ_REDIS_PASSWORD } : {}),
  ...(process.env.BULLMQ_REDIS_TLS === 'true' ? { tls: {} } : {})
}}

export function getQueue(queues: Record<string, Queue>, q: string) {
  if (!queues[q]) { queues[q] = new Queue(q, bull) }
  return queues[q]
}
