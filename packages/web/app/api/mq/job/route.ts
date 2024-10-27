import { NextRequest } from 'next/server'
import { Queue } from 'bullmq'
import { getQueue } from '../bull'

const queues: Record<string, Queue> = {}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const queueName = searchParams.get('queueName')
  const jobId = searchParams.get('jobId')
  if(!queueName || !jobId) { return new Response(null, { status: 400 }) }

  const queue = getQueue(queues, queueName)
  const job = await queue.getJob(jobId)
  return new Response(JSON.stringify(job))
}
