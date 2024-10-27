import { NextRequest } from 'next/server'
import { Queue } from 'bullmq'
import { getQueue } from '../bull'

const queues: Record<string, Queue> = {}

export async function POST(request: NextRequest) {
  const { queueName, jobName, data, options } = await request.json()
  const queue = getQueue(queues, queueName)
  const { id } = await queue.add(jobName, data, options)
  return new Response(JSON.stringify({ queueName, jobId: id }))
}
