import { strict as assert } from 'node:assert'

const refresh = vi.fn().mockResolvedValue(undefined)
const refreshLatest = vi.fn().mockResolvedValue(undefined)
const refreshHistorical = vi.fn().mockResolvedValue(undefined)
const refreshReportsLatest = vi.fn().mockResolvedValue(undefined)
const refreshReportsHistorical = vi.fn().mockResolvedValue(undefined)

vi.mock('../rest/refresh-vaults', () => ({ refresh }))
vi.mock('../rest/timeseries/refresh', () => ({ refreshLatest }))
vi.mock('../rest/timeseries/refresh-historical', () => ({ refreshHistorical }))
vi.mock('../rest/reports/refresh', () => ({ refreshLatest: refreshReportsLatest }))
vi.mock('../rest/reports/refresh-historical', () => ({ refreshHistorical: refreshReportsHistorical }))

const ROUTES = [
  {
    path: '/api/cron/refresh-cache',
    module: () => import('./refresh-cache/route'),
    job: refresh,
    kumaEnvVar: 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS',
    maxDuration: 300,
    scheduled: true,
  },
  {
    path: '/api/cron/timeseries-refresh',
    module: () => import('./timeseries-refresh/route'),
    job: refreshLatest,
    kumaEnvVar: 'UPTIME_KUMA_PUSH_URL_TIMESERIES_REFRESH',
    maxDuration: 300,
    scheduled: true,
  },
  {
    path: '/api/cron/timeseries-refresh-historical',
    module: () => import('./timeseries-refresh-historical/route'),
    job: refreshHistorical,
    kumaEnvVar: 'UPTIME_KUMA_PUSH_URL_TIMESERIES_HISTORICAL',
    maxDuration: 800,
    scheduled: true,
  },
  {
    path: '/api/cron/reports-refresh',
    module: () => import('./reports-refresh/route'),
    job: refreshReportsLatest,
    kumaEnvVar: 'UPTIME_KUMA_PUSH_URL_REPORTS_REFRESH',
    maxDuration: 300,
    scheduled: false,
  },
  {
    path: '/api/cron/reports-refresh-historical',
    module: () => import('./reports-refresh-historical/route'),
    job: refreshReportsHistorical,
    kumaEnvVar: 'UPTIME_KUMA_PUSH_URL_REPORTS_HISTORICAL',
    maxDuration: 800,
    scheduled: false,
  },
]

describe('cron routes', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    global.fetch = originalFetch
  })

  it('schedules exactly the routes meant to run on a timer', async () => {
    const vercelConfig = await import('../../../vercel.json')
    const paths = (vercelConfig.default.crons as Array<{ path: string }>).map((cron) => cron.path)
    assert.deepEqual(
      paths.sort(),
      ROUTES.filter((route) => route.scheduled).map((route) => route.path).sort(),
    )
  })

  it('runs the historical timeseries rebuild once a day', async () => {
    const vercelConfig = await import('../../../vercel.json')
    const cron = (vercelConfig.default.crons as Array<{ path: string, schedule: string }>)
      .find((entry) => entry.path === '/api/cron/timeseries-refresh-historical')

    assert.match(cron!.schedule, /^\d+ \d+ \* \* \*$/)
  })

  for (const route of ROUTES) {
    it(`${route.path} runs its own job and pushes to its own uptime kuma url`, async () => {
      vi.stubEnv('CRON_SECRET', 'secret')
      vi.stubEnv(route.kumaEnvVar, `https://kuma.example/push/${route.kumaEnvVar}`)
      const fetchMock = vi.fn().mockResolvedValue(new Response(null))
      global.fetch = fetchMock as unknown as typeof fetch

      const { GET, runtime, dynamic, maxDuration } = await route.module()

      assert.equal(runtime, 'nodejs')
      assert.equal(dynamic, 'force-dynamic')
      assert.equal(maxDuration, route.maxDuration)

      const response = await GET(new Request(`http://localhost${route.path}`, {
        headers: { authorization: 'Bearer secret' },
      }))

      assert.equal(response.status, 200)
      assert.equal(route.job.mock.calls.length, 1)
      for (const other of ROUTES.filter((candidate) => candidate !== route)) {
        assert.equal(other.job.mock.calls.length, 0)
      }
      assert.equal(fetchMock.mock.calls.length, 1)
      assert.match(fetchMock.mock.calls[0][0] as string, new RegExp(route.kumaEnvVar))
    })
  }
})
