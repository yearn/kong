import { strict as assert } from 'node:assert'
import { createCronHandler } from './handler'

describe('createCronHandler', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    vi.unstubAllEnvs()
    global.fetch = originalFetch
  })

  it('returns 401 when no authorization header', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const job = vi.fn().mockResolvedValue(undefined)
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    const response = await handler(new Request('http://localhost/api/cron/x'))

    assert.equal(response.status, 401)
    assert.equal(job.mock.calls.length, 0)
  })

  it('returns 401 when wrong bearer', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const job = vi.fn().mockResolvedValue(undefined)
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    const response = await handler(new Request('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer wrong' },
    }))

    assert.equal(response.status, 401)
    assert.equal(job.mock.calls.length, 0)
  })

  it('returns 401 when CRON_SECRET is unset even if header is Bearer undefined', async () => {
    vi.stubEnv('CRON_SECRET', undefined)
    const job = vi.fn().mockResolvedValue(undefined)
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    const response = await handler(new Request('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer undefined' },
    }))

    assert.equal(response.status, 401)
    assert.equal(job.mock.calls.length, 0)
  })

  it('returns 200 and calls the job when bearer matches', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const job = vi.fn().mockResolvedValue(undefined)
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    const response = await handler(new Request('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer secret' },
    }))

    assert.equal(response.status, 200)
    assert.equal(job.mock.calls.length, 1)
  })

  it('returns 500 when job rejects', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const job = vi.fn().mockRejectedValue(new Error('boom'))
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    const response = await handler(new Request('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer secret' },
    }))

    assert.equal(response.status, 500)
  })

  it('pushes status=up to uptime kuma on success when the env var is set', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    vi.stubEnv('UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS', 'https://kuma.example/push/abc')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    global.fetch = fetchMock as unknown as typeof fetch
    const job = vi.fn().mockResolvedValue(undefined)
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    await handler(new Request('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer secret' },
    }))

    assert.equal(fetchMock.mock.calls.length, 1)
    assert.match(fetchMock.mock.calls[0][0] as string, /status=up/)
  })

  it('pushes status=down to uptime kuma when the job fails', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    vi.stubEnv('UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS', 'https://kuma.example/push/abc')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    global.fetch = fetchMock as unknown as typeof fetch
    const job = vi.fn().mockRejectedValue(new Error('boom'))
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    await handler(new Request('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer secret' },
    }))

    assert.equal(fetchMock.mock.calls.length, 1)
    assert.match(fetchMock.mock.calls[0][0] as string, /status=down/)
  })

  it('does not call fetch when the uptime kuma env var is unset', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    vi.stubEnv('UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS', undefined)
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const job = vi.fn().mockResolvedValue(undefined)
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    await handler(new Request('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer secret' },
    }))

    assert.equal(fetchMock.mock.calls.length, 0)
  })

  it('does not change the response status when the uptime kuma push rejects', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    vi.stubEnv('UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS', 'https://kuma.example/push/abc')
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    global.fetch = fetchMock as unknown as typeof fetch
    const job = vi.fn().mockResolvedValue(undefined)
    const handler = createCronHandler(job, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')

    const response = await handler(new Request('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer secret' },
    }))

    assert.equal(response.status, 200)
  })
})
