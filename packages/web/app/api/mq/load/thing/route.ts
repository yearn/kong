import { NextRequest } from 'next/server'
import { Queue } from 'bullmq'
import { bull } from '../../bull'

const queue = new Queue('load', bull)

export async function POST(request: NextRequest) {
  const thing = await request.json()
  const { id } = await queue.add('thing', thing)
  return new Response(JSON.stringify({ jobId: id }))
}
