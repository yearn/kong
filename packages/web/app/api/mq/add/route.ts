import { NextRequest } from 'next/server'
import { Queue } from 'bullmq'
import { getQueue } from '../bull'
import { CORS_HEADERS } from '../../headers'

const headers = { ...CORS_HEADERS }
const queues: Record<string, Queue> = {}

export async function OPTIONS() {
  const response = new Response('', { headers })
  return response
}

export async function POST(request: NextRequest) {
  const { queueName, jobName, data, options } = await request.json()
  const queue = getQueue(queues, queueName)
  const { id } = await queue.add(jobName, data, options)
  return new Response(JSON.stringify({ queueName, jobId: id }), { headers })
}
