import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { parseTriggerDelivery } from '@neon/functions/triggers'
import type { JobName } from './job-types.js'
import { getRuntime, type Runtime } from './runtime.js'
import { getRefreshStatus, inspectPublishedValue, runRefresh } from './storage/index.js'
import type { RefreshJob } from './job-types.js'

const scheduledJobs = new Set<JobName>([
  'refresh-cache',
  'tvl-refresh',
  'timeseries-refresh',
  'timeseries-refresh-historical',
])
const allJobs = new Set<JobName>([
  ...scheduledJobs,
  'reports-refresh',
  'reports-refresh-historical',
])

type HandlerOptions = {
  getRuntime?: () => Runtime
  adminToken?: string
  runRefresh?: typeof runRefresh
  getRefreshJob?: (job: JobName) => RefreshJob | Promise<RefreshJob>
  now?: () => Date
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function authorized(request: Request, token: string | undefined): boolean {
  if (!token) return false
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '')
  if (!match) return false
  const presented = createHash('sha256').update(match[1]).digest()
  const expected = createHash('sha256').update(token).digest()
  return timingSafeEqual(presented, expected)
}

function asJobName(value: string): JobName | undefined {
  return allJobs.has(value as JobName) ? (value as JobName) : undefined
}

function responseForResult(result: Awaited<ReturnType<typeof runRefresh>>): Response {
  if (result === 'success') return json({ status: result })
  if (result === 'duplicate') return json({ status: result })
  if (result === 'stale') return json({ status: result })
  return new Response(JSON.stringify({ status: result }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'retry-after': '30' },
  })
}

export function createHandler(options: HandlerOptions = {}) {
  const runtimeProvider = options.getRuntime ?? getRuntime
  const refresh = options.runRefresh ?? runRefresh
  const jobLookup = options.getRefreshJob
    ? async (job: JobName) => options.getRefreshJob!(job)
    : async (job: JobName) => (await import('./jobs/index.js')).getRefreshJob(job)
  const now = options.now ?? (() => new Date())

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const path = url.pathname.replace(/\/$/, '') || '/'

      if (path === '/health') return json({ status: 'ok' })

      const triggerJob = path.startsWith('/jobs/') ? asJobName(path.slice('/jobs/'.length)) : undefined
      if (path.startsWith('/jobs/') && (!triggerJob || !scheduledJobs.has(triggerJob))) {
        return json({ error: 'not_found' }, 404)
      }
      if (triggerJob) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
        const parsed = await parseTriggerDelivery(request)
        if (!parsed.ok) {
          const status = parsed.error === 'invalid_body' ? 400 : 401
          return json({ error: parsed.error }, status)
        }
        const invocation = parsed.invocation
        if (invocation.type !== 'schedule') return json({ error: 'invalid_trigger_type' }, 400)
        const scheduledAt = invocation.data.scheduledAt

        try {
          const startedAt = Date.now()
          console.info('REST cache refresh started', {
            job: triggerJob,
            invocationId: invocation.invocationId,
          })
          const runtime = runtimeProvider()
          const job = await jobLookup(triggerJob)
          const result = await refresh(
            runtime.cachePool,
            {
              job: triggerJob,
              invocationId: invocation.invocationId,
              scheduledAt,
            },
            async cache => job({
              sourceDb: runtime.sourceDb,
              cache,
              now: new Date(scheduledAt),
              historicalFullRefresh: process.env.REST_CACHE_HISTORICAL_FULL_REFRESH === 'true',
            }),
          )
          console.info('REST cache refresh finished', {
            job: triggerJob,
            invocationId: invocation.invocationId,
            status: result,
            durationMs: Date.now() - startedAt,
          })
          return responseForResult(result)
        } catch (error) {
          console.error('Scheduled REST cache refresh failed', { job: triggerJob, error })
          return json({ error: 'refresh_failed' }, 500)
        }
      }

      if (path === '/admin' || path.startsWith('/admin/')) {
        if (request.method !== 'GET' && request.method !== 'POST') {
          return json({ error: 'method_not_allowed' }, 405)
        }
        const token = options.adminToken ?? process.env.REST_CACHE_ADMIN_TOKEN
        if (!authorized(request, token)) return json({ error: 'unauthorized' }, 401)

        if (path.startsWith('/admin/run/')) {
          if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
          const name = asJobName(path.slice('/admin/run/'.length))
          if (!name) return json({ error: 'not_found' }, 404)
          const currentTime = now()
          try {
            const invocationId = randomUUID()
            const startedAt = Date.now()
            console.info('REST cache refresh started', { job: name, invocationId })
            const runtime = runtimeProvider()
            const job = await jobLookup(name)
            const result = await refresh(
              runtime.cachePool,
              { job: name, invocationId, scheduledAt: null },
              async cache => job({
                sourceDb: runtime.sourceDb,
                cache,
                now: currentTime,
                historicalFullRefresh: process.env.REST_CACHE_HISTORICAL_FULL_REFRESH === 'true',
              }),
            )
            console.info('REST cache refresh finished', {
              job: name,
              invocationId,
              status: result,
              durationMs: Date.now() - startedAt,
            })
            return responseForResult(result)
          } catch (error) {
            console.error('Manual REST cache refresh failed', { job: name, error })
            return json({ error: 'refresh_failed' }, 500)
          }
        }

        if (path === '/admin/status') {
          if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
          try {
            const { cachePool } = runtimeProvider()
            const statuses = await Promise.all([...allJobs].map(job => getRefreshStatus(cachePool, job)))
            return json({ jobs: statuses })
          } catch (error) {
            console.error('Unable to read REST cache status', error)
            return json({ error: 'status_unavailable' }, 500)
          }
        }

        const cachePath = /^\/admin\/cache\/([^/]+)\/(.+)$/.exec(path)
        if (cachePath) {
          if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
          let job: JobName | undefined
          let key: string
          try {
            job = asJobName(decodeURIComponent(cachePath[1]))
            key = decodeURIComponent(cachePath[2])
          } catch {
            return json({ error: 'invalid_path' }, 400)
          }
          if (!job || !key) return json({ error: 'not_found' }, 404)
          try {
            const { cachePool } = runtimeProvider()
            const value = await inspectPublishedValue(cachePool, job, key)
            if (value === null || value === undefined) return json({ error: 'cache_miss' }, 404)
            try {
              return json({ job, key, value: JSON.parse(value) })
            } catch {
              return json({ job, key, value })
            }
          } catch (error) {
            console.error('Unable to read REST cache entry', error)
            return json({ error: 'cache_unavailable' }, 500)
          }
        }

        return json({ error: 'not_found' }, 404)
      }

      return json({ error: 'not_found' }, 404)
    },
  }
}

export const handler = createHandler()
