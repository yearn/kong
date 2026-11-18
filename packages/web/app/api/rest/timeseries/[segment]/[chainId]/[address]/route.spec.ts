import { strict as assert } from 'node:assert'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'

const get = vi.fn()
const lastRefreshHeaders = vi.fn()

vi.mock('@/app/api/rest/cache', () => ({
  getKeyvClient: () => ({ get }),
  lastRefreshHeaders,
}))

async function callResponse(components?: string) {
  const { GET } = await import('./route')
  const url = `http://localhost/api/rest/timeseries/tvl/1/0x1111111111111111111111111111111111111111${components ?? ''}`
  return GET(new Request(url) as never, {
    params: Promise.resolve({
      segment: 'tvl',
      chainId: '1',
      address: '0x1111111111111111111111111111111111111111'
    })
  })
}

async function call(components?: string) {
  return await (await callResponse(components)).json()
}

describe('rest timeseries route', () => {
  const cutoff = Date.UTC(2025, 10, 19) / 1000
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 18, 23, 59))
    get.mockReset()
    lastRefreshHeaders.mockReset()
    lastRefreshHeaders.mockResolvedValue({})
  })

  afterEach(() => vi.restoreAllMocks())

  it('omits null-valued days instead of serving them as zero', async () => {
    get.mockImplementation(async (key: string) =>
      key.includes('latest') ? [] : [
        { time: cutoff, component: 'tvl', value: 100 },
        { time: cutoff + 86400, component: 'tvl', value: null },
        { time: cutoff + 172800, component: 'tvl', value: 300 }
      ]
    )

    const rows = await call()

    assert.deepEqual(rows, [
      { time: cutoff, component: 'tvl', value: 100 },
      { time: cutoff + 172800, component: 'tvl', value: 300 }
    ])
  })

  it('omits a null latest row that overrides a historical day', async () => {
    get.mockImplementation(async (key: string) =>
      key.includes('latest')
        ? [{ time: cutoff + 86400, component: 'tvl', value: null }]
        : [{ time: cutoff + 86400, component: 'tvl', value: 200 }]
    )

    const rows = await call()

    assert.deepEqual(rows, [])
  })

  it('hides expired points from both cache entries before the next refresh', async () => {
    const retained = { time: cutoff, component: 'tvl', value: '10' }
    const expired = { ...retained, time: cutoff - 86400 }
    get.mockImplementation(async (key: string) => key.includes('latest') ? [expired] : [expired, retained])
    assert.deepEqual(await call(), [retained])
  })

  it('exposes x-last-refresh from the timeseries-refresh job', async () => {
    get.mockResolvedValue([])
    lastRefreshHeaders.mockResolvedValue({
      'x-last-refresh': '2026-01-02T03:04:05.000Z',
      'access-control-expose-headers': 'x-last-refresh',
    })

    const response = await callResponse()

    assert.equal(response.headers.get('x-last-refresh'), '2026-01-02T03:04:05.000Z')
    assert.equal(response.headers.get('access-control-expose-headers'), 'x-last-refresh')
    assert.deepEqual(lastRefreshHeaders.mock.calls, [['timeseries-refresh']])
  })
})
