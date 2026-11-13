import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import type { Runtime } from '../src/runtime.js'
import { createHandler } from '../src/handler.js'
import type { JobName } from '../src/job-types.js'
import type { RefreshJob } from '../src/job-types.js'
import type { runRefresh as runRefreshType } from '../src/storage/index.js'

const runtime = {
  cachePool: {} as Pool,
  sourceDb: {} as Pool,
} satisfies Runtime

function request(path: string, options: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, options)
}

describe('REST cache function handler', () => {
  beforeEach(() => {
    vi.stubEnv('REST_CACHE_ADMIN_TOKEN', '')
    vi.stubEnv('REST_CACHE_HISTORICAL_FULL_REFRESH', 'false')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('rejects admin requests when no bearer token is configured', async () => {
    const getRuntime = vi.fn(() => runtime)
    const handler = createHandler({ getRuntime })

    const response = await handler.fetch(request('/admin/status'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(getRuntime).not.toHaveBeenCalled()
  })

  it('requires the configured bearer token before manual job execution', async () => {
    const getRuntime = vi.fn(() => runtime)
    const runRefresh = vi.fn<typeof runRefreshType>(async () => 'success')
    const handler = createHandler({ getRuntime, adminToken: 'correct-secret', runRefresh })

    const response = await handler.fetch(request('/admin/run/reports-refresh', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    }))

    expect(response.status).toBe(401)
    expect(runRefresh).not.toHaveBeenCalled()
    expect(getRuntime).not.toHaveBeenCalled()
  })

  it('returns a retry hint when a manual refresh cannot acquire its lease', async () => {
    const job = vi.fn<RefreshJob>(async () => {})
    const getRuntime = vi.fn(() => runtime)
    const runRefresh = vi.fn<typeof runRefreshType>(async () => 'busy')
    const getRefreshJob = vi.fn((_: JobName) => job)
    const handler = createHandler({
      getRuntime,
      adminToken: 'test-token',
      runRefresh,
      getRefreshJob,
      now: () => new Date('2026-11-13T12:00:00.000Z'),
    })

    const response = await handler.fetch(request('/admin/run/reports-refresh-historical', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    }))

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.json()).toEqual({ status: 'busy' })
    expect(runRefresh).toHaveBeenCalledWith(
      runtime.cachePool,
      expect.objectContaining({
        job: 'reports-refresh-historical',
        invocationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        scheduledAt: null,
      }),
      expect.any(Function),
    )
    expect(getRefreshJob).toHaveBeenCalledWith('reports-refresh-historical')
  })

  it('accepts only verified schedule delivery on allowlisted trigger paths', async () => {
    const invocationId = 'invocation-123'
    const runRefresh = vi.fn<typeof runRefreshType>(async () => 'success')
    const handler = createHandler({
      getRuntime: () => runtime,
      runRefresh,
      getRefreshJob: () => vi.fn<RefreshJob>(async () => {}),
    })
    const body = {
      version: 1,
      invocation_id: invocationId,
      trigger: { type: 'schedule', id: 'trigger-1', name: 'refresh-cache' },
      data: { scheduled_at: '2026-11-13T12:00:00.000Z' },
    }

    const rejected = await handler.fetch(request('/jobs/refresh-cache', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    expect(rejected.status).toBe(401)

    const accepted = await handler.fetch(request('/jobs/refresh-cache', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-neon-trigger-invocation-id': invocationId,
      },
      body: JSON.stringify(body),
    }))
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual({ status: 'success' })
    expect(runRefresh).toHaveBeenCalledWith(
      runtime.cachePool,
      expect.objectContaining({ job: 'refresh-cache', invocationId }),
      expect.any(Function),
    )
  })

  it('does not allow callers to select arbitrary jobs or inject invocation identifiers', async () => {
    const runRefresh = vi.fn<typeof runRefreshType>(async () => 'success')
    const getRuntime = vi.fn(() => runtime)
    const handler = createHandler({
      getRuntime,
      adminToken: 'test-token',
      runRefresh,
    })

    const arbitraryJob = await handler.fetch(request('/admin/run/drop-all-tables', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    }))
    const arbitraryTrigger = await handler.fetch(request('/jobs/drop-all-tables', {
      method: 'POST',
      headers: { 'x-neon-trigger-invocation-id': 'caller-id' },
    }))

    expect(arbitraryJob.status).toBe(404)
    expect(arbitraryTrigger.status).toBe(404)
    expect(runRefresh).not.toHaveBeenCalled()
    expect(getRuntime).not.toHaveBeenCalled()
  })
})
