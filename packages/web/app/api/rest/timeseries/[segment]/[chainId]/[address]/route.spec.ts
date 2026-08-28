import { strict as assert } from 'node:assert'
import { beforeEach, describe, it, vi } from 'vitest'

const get = vi.fn()

vi.mock('@/app/api/rest/cache', () => ({
  getKeyvClient: () => ({ get })
}))

async function call(components?: string) {
  const { GET } = await import('./route')
  const url = `http://localhost/api/rest/timeseries/tvl/1/0x1111111111111111111111111111111111111111${components ?? ''}`
  const response = await GET(new Request(url) as never, {
    params: Promise.resolve({
      segment: 'tvl',
      chainId: '1',
      address: '0x1111111111111111111111111111111111111111'
    })
  })
  return await response.json()
}

describe('rest timeseries route', () => {
  beforeEach(() => {
    get.mockReset()
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
})
