import { NextRequest, NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import { bull } from '../bull'
import chains from '@/chains'

// Only allow in development
const isDev = process.env.NODE_ENV === 'development'

// Queue definitions
const queueNames = [
  'fanout',
  'extract',
  ...chains.map(c => `extract-${c.id}`),
  'load',
  'probe'
]

// Escape HTML to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Cache queues
const queues: Map<string, Queue> = new Map()

function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, bull))
  }
  return queues.get(name)!
}

interface QueueStats {
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

async function getQueueStats(name: string): Promise<QueueStats> {
  const queue = getQueue(name)
  const [counts, isPaused] = await Promise.all([
    queue.getJobCounts(),
    queue.isPaused()
  ])
  return { name, ...counts, isPaused } as QueueStats
}

async function getQueueJobs(name: string, status: string, start = 0, end = 20) {
  const queue = getQueue(name)
  const validStatuses = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused', 'prioritized']
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}`)
  }
  // @ts-expect-error - dynamic status access
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

async function handler(req: NextRequest) {
  if (!isDev) {
    return NextResponse.json(
      { error: 'Queue dashboard is only available in development' },
      { status: 403 }
    )
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.replace('/api/mq', '').split('/').filter(Boolean)

  try {
    // GET /api/mq - list all queues with stats
    if (pathParts.length === 0) {
      const stats = await Promise.all(queueNames.map(getQueueStats))
      const html = renderDashboard(stats)
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    // GET /api/mq/json - JSON stats
    if (pathParts[0] === 'json') {
      const stats = await Promise.all(queueNames.map(getQueueStats))
      return NextResponse.json(stats)
    }

    // GET /api/mq/:queue - queue details
    if (pathParts.length === 1) {
      const queueName = decodeURIComponent(pathParts[0])
      if (!queueNames.includes(queueName)) {
        return NextResponse.json({ error: 'Queue not found' }, { status: 404 })
      }
      const stats = await getQueueStats(queueName)
      const html = renderQueueDetail(queueName, stats)
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    // GET /api/mq/:queue/:status - jobs by status
    if (pathParts.length === 2) {
      const queueName = decodeURIComponent(pathParts[0])
      const status = pathParts[1]
      if (!queueNames.includes(queueName)) {
        return NextResponse.json({ error: 'Queue not found' }, { status: 404 })
      }
      const pageSize = 50
      const stats = await getQueueStats(queueName)
      const total = stats[status as keyof QueueStats] as number || 0

      let start = parseInt(url.searchParams.get('start') || '0')
      let end = parseInt(url.searchParams.get('end') || String(pageSize))

      // Handle "last" page request
      if (url.searchParams.get('last') === 'true') {
        start = Math.max(0, total - pageSize)
        end = total
      }

      const json = url.searchParams.get('json') === 'true'
      const jobs = await getQueueJobs(queueName, status, start, end)

      if (json) {
        return NextResponse.json(jobs)
      }

      const html = renderJobsList(queueName, status, jobs, start, end, total)
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    console.error('Bull Board error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

function renderDashboard(stats: Awaited<ReturnType<typeof getQueueStats>>[]) {
  const rows = stats.map(q => {
    const prioritized = q.prioritized || 0
    const waiting = q.waiting + prioritized
    return `
    <tr>
      <td><a href="/api/mq/${encodeURIComponent(q.name)}">${q.name}</a></td>
      <td class="${waiting > 0 ? 'warning' : ''}">${waiting}</td>
      <td class="${q.active > 0 ? 'info' : ''}">${q.active}</td>
      <td>${q.completed}</td>
      <td class="${q.failed > 0 ? 'danger' : ''}">${q.failed}</td>
      <td>${q.delayed}</td>
      <td>${q.isPaused ? 'Yes' : 'No'}</td>
    </tr>
  `}).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <title>MQ Dashboard</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; margin: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #fff; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
    th { background: #16213e; }
    tr:hover { background: #1f3460; }
    a { color: #4da6ff; }
    .warning { background: #665c00; }
    .danger { background: #5c0000; color: #ff6b6b; }
    .info { background: #003d5c; }
    .note { color: #888; font-size: 12px; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>MQ Dashboard</h1>
  <table>
    <tr>
      <th>Queue</th>
      <th>Waiting</th>
      <th>Active</th>
      <th>Completed</th>
      <th>Failed</th>
      <th>Delayed</th>
      <th>Paused</th>
    </tr>
    ${rows}
  </table>
  <p class="note">Auto-refreshes every 5 seconds. <a href="/api/mq/json">JSON API</a></p>
</body>
</html>`
}

function renderQueueDetail(name: string, stats: Awaited<ReturnType<typeof getQueueStats>>) {
  const prioritized = stats.prioritized || 0
  const statuses: (keyof QueueStats)[] = ['prioritized', 'waiting', 'active', 'failed', 'delayed', 'completed']
  const links = statuses.map(s =>
    `<a href="/api/mq/${encodeURIComponent(name)}/${s}">${s} (${stats[s]})</a>`
  ).join(' | ')

  return `<!DOCTYPE html>
<html>
<head>
  <title>${name} - MQ Dashboard</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; margin: 20px; background: #1a1a2e; color: #eee; }
    h1, h2 { color: #fff; }
    a { color: #4da6ff; }
    .stats { background: #16213e; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .stats span { margin-right: 20px; }
    .warning { color: #ffd93d; }
    .danger { color: #ff6b6b; }
    .note { color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <p><a href="/api/mq">&larr; Back to all queues</a></p>
  <h1>${name}</h1>
  <div class="stats">
    <span>Prioritized: <strong class="${prioritized > 0 ? 'warning' : ''}">${prioritized}</strong></span>
    <span>Waiting: <strong class="${stats.waiting > 0 ? 'warning' : ''}">${stats.waiting}</strong></span>
    <span>Active: <strong>${stats.active}</strong></span>
    <span>Failed: <strong class="${stats.failed > 0 ? 'danger' : ''}">${stats.failed}</strong></span>
    <span>Delayed: <strong>${stats.delayed}</strong></span>
    <span>Completed: <strong>${stats.completed}</strong></span>
  </div>
  <h2>View Jobs</h2>
  <p>${links}</p>
  <p class="note">Click a status to view jobs as JSON. Add ?start=0&end=100 to paginate.</p>
</body>
</html>`
}

interface JobInfo {
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

function renderJobsList(queueName: string, status: string, jobs: JobInfo[], start: number, end: number, total: number) {
  const pageSize = end - start
  const prevStart = Math.max(0, start - pageSize)
  const prevEnd = start
  const nextStart = end
  const nextEnd = end + pageSize
  const hasMore = start + jobs.length < total

  const rows = jobs.map(job => {
    const age = job.timestamp ? Math.floor((Date.now() - job.timestamp) / 1000) : 0
    const ageStr = age > 3600 ? `${Math.floor(age / 3600)}h` : age > 60 ? `${Math.floor(age / 60)}m` : `${age}s`
    const dataJson = JSON.stringify(job.data)
    const dataPreview = escapeHtml(dataJson.slice(0, 200))
    const dataFull = escapeHtml(JSON.stringify(job.data, null, 2))

    return `
    <tr>
      <td>${job.id}</td>
      <td>${escapeHtml(job.name)}</td>
      <td title="${new Date(job.timestamp || 0).toISOString()}">${ageStr} ago</td>
      <td>${job.attemptsMade}</td>
      <td class="data" title="${dataFull}">${dataPreview}${dataJson.length > 200 ? '...' : ''}</td>
      ${status === 'failed' ? `<td class="error">${escapeHtml(job.failedReason || '')}</td>` : ''}
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <title>${queueName} - ${status} - MQ Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; margin: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #fff; }
    a { color: #4da6ff; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #333; padding: 6px 10px; text-align: left; vertical-align: top; }
    th { background: #16213e; position: sticky; top: 0; }
    tr:hover { background: #1f3460; }
    .data { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; }
    .error { color: #ff6b6b; max-width: 300px; }
    .pagination { margin: 15px 0; }
    .pagination a { margin-right: 10px; padding: 5px 10px; background: #16213e; border-radius: 4px; text-decoration: none; }
    .pagination a:hover { background: #1f3460; }
    .pagination .disabled { opacity: 0.4; pointer-events: none; }
    .note { color: #888; font-size: 12px; }
    .count { color: #888; margin-left: 10px; font-size: 14px; }
  </style>
</head>
<body>
  <p><a href="/api/mq/${encodeURIComponent(queueName)}">&larr; Back to ${queueName}</a></p>
  <h1>${queueName} / ${status} <span class="count">(${start + 1}-${start + jobs.length} of ${total})</span></h1>
  <div class="pagination">
    <a href="?start=0&end=${pageSize}" class="${start === 0 ? 'disabled' : ''}">&laquo; First</a>
    <a href="?start=${prevStart}&end=${prevEnd}" class="${start === 0 ? 'disabled' : ''}">&larr; Prev</a>
    <a href="?start=${nextStart}&end=${nextEnd}" class="${!hasMore ? 'disabled' : ''}">Next &rarr;</a>
    <a href="?last=true" class="${!hasMore ? 'disabled' : ''}">Last &raquo;</a>
    <a href="?json=true&start=${start}&end=${end}">JSON</a>
  </div>
  <table>
    <tr>
      <th>ID</th>
      <th>Name</th>
      <th>Age</th>
      <th>Attempts</th>
      <th>Data</th>
      ${status === 'failed' ? '<th>Error</th>' : ''}
    </tr>
    ${rows}
  </table>
  <p class="note">Hover over data cell to see full JSON</p>
</body>
</html>`
}

export const GET = handler
