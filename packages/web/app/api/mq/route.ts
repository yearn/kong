import { NextRequest, NextResponse } from 'next/server'
import { getAllQueueStats, getQueueStats, getQueueJobs, queueNames, validStatuses, JobStatus } from '../../mq/lib'

const isDev = process.env.NODE_ENV === 'development'

export async function GET(req: NextRequest) {
  if (!isDev) {
    return NextResponse.json({ error: 'Only available in development' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const queue = searchParams.get('queue')
  const status = searchParams.get('status') as JobStatus | null
  const start = parseInt(searchParams.get('start') || '0')
  const end = parseInt(searchParams.get('end') || '50')

  try {
    // GET /api/mq - all queue stats
    if (!queue) {
      const stats = await getAllQueueStats()
      return NextResponse.json(stats)
    }

    // Validate queue name
    if (!queueNames.includes(queue)) {
      return NextResponse.json({ error: 'Queue not found' }, { status: 404 })
    }

    // GET /api/mq?queue=X - single queue stats
    if (!status) {
      const stats = await getQueueStats(queue)
      return NextResponse.json(stats)
    }

    // Validate status
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // GET /api/mq?queue=X&status=Y - jobs list
    const jobs = await getQueueJobs(queue, status, start, end)
    return NextResponse.json(jobs)
  } catch (error) {
    console.error('MQ API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
