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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const queueName = searchParams.get('queueName')
  const jobId = searchParams.get('jobId')
  if(!queueName || !jobId) { return new Response(null, { status: 400 }) }

  const queue = getQueue(queues, queueName)
  const job = await queue.getJob(jobId)
  return new Response(JSON.stringify(job), { headers })
}
