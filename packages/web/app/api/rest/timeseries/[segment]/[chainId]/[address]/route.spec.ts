import { strict as assert } from 'node:assert'
import { beforeEach, describe, it, vi } from 'vitest'

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
  beforeEach(() => {
    get.mockReset()
    lastRefreshHeaders.mockReset()
    lastRefreshHeaders.mockResolvedValue({})
  })

  it('omits null-valued days instead of serving them as zero', async () => {
    get.mockImplementation(async (key: string) =>
      key.includes('latest') ? [] : [
        { time: 1, component: 'tvl', value: 100 },
        { time: 2, component: 'tvl', value: null },
        { time: 3, component: 'tvl', value: 300 }
      ]
    )

    const rows = await call()

    assert.deepEqual(rows, [
      { time: 1, component: 'tvl', value: 100 },
      { time: 3, component: 'tvl', value: 300 }
    ])
  })

  it('omits a null latest row that overrides a historical day', async () => {
    get.mockImplementation(async (key: string) =>
      key.includes('latest')
        ? [{ time: 2, component: 'tvl', value: null }]
        : [{ time: 2, component: 'tvl', value: 200 }]
    )

    const rows = await call()

    assert.deepEqual(rows, [])
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
