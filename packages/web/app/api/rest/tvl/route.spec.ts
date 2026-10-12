import { strict as assert } from 'node:assert'

const get = vi.fn()
const lastRefreshHeaders = vi.fn()

vi.mock('../cache', () => ({
  getKeyvClient: () => ({ get }),
  lastRefreshHeaders,
}))

const payload = {
  tvl: 260,
  grossTvl: 300,
  deductedTvl: 40,
  updatedAt: '2026-01-02T03:04:05.000Z',
  chains: [
    { chainId: 1, tvl: 100, grossTvl: 120, deductedTvl: 20 },
    { chainId: 10, tvl: 160, grossTvl: 180, deductedTvl: 20 },
  ],
  vaults: [
    { chainId: 1, address: '0x0000000000000000000000000000000000000001', contribution: 100 },
    { chainId: 10, address: '0x0000000000000000000000000000000000000001', contribution: 160 },
  ],
}

async function call(path = '/api/rest/tvl') {
  const { GET } = await import('./route')
  return GET(new Request(`http://localhost${path}`))
}

describe('rest TVL route', () => {
  beforeEach(() => {
    get.mockReset()
    lastRefreshHeaders.mockReset()
    lastRefreshHeaders.mockResolvedValue({})
  })

  it('serves the cached aggregate and public cache/CORS/last-refresh headers', async () => {
    get.mockResolvedValue(payload)
    lastRefreshHeaders.mockResolvedValue({
      'x-last-refresh': '2025-12-31T00:00:00.000Z',
      'access-control-expose-headers': 'x-last-refresh',
    })

    const response = await call()

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      tvl: 260,
      chains: [{ chainId: 1, tvl: 100 }, { chainId: 10, tvl: 160 }],
    })
    assert.equal(get.mock.calls.length, 1)
    assert.deepEqual(get.mock.calls[0], ['rest:tvl:aggregate'])
    assert.deepEqual(lastRefreshHeaders.mock.calls, [['tvl-refresh']])
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.match(response.headers.get('cache-control') ?? '', /public/)
    assert.equal(response.headers.get('x-last-refresh'), payload.updatedAt)
    assert.equal(response.headers.get('access-control-expose-headers'), 'x-last-refresh')
  })

  it('filters chains and recalculates tvl for a requested chain', async () => {
    get.mockResolvedValue(payload)

    const response = await call('/api/rest/tvl?chainId=10')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      tvl: 160,
      chains: [{ chainId: 10, tvl: 160 }],
    })
  })

  it('returns a CORS 400 for a non-integer chainId without reading the cache', async () => {
    const response = await call('/api/rest/tvl?chainId=1.5')

    assert.equal(response.status, 400)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal(get.mock.calls.length, 0)
  })

  it('returns a CORS 400 for a chainId outside the safe integer range', async () => {
    const response = await call('/api/rest/tvl?chainId=9007199254740992')

    assert.equal(response.status, 400)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal(get.mock.calls.length, 0)
  })

  it('returns a CORS 404 when no cached aggregate exists and keeps the refresh header', async () => {
    get.mockResolvedValue(undefined)
    lastRefreshHeaders.mockResolvedValue({ 'x-last-refresh': '2026-01-02T03:04:05.000Z' })

    const response = await call()

    assert.equal(response.status, 404)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal(response.headers.get('x-last-refresh'), '2026-01-02T03:04:05.000Z')
  })

  it('propagates Redis read failures so the framework can return a server error', async () => {
    get.mockRejectedValue(new Error('redis unavailable'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await assert.rejects(call(), /redis unavailable/)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('answers preflight requests with 204 and CORS headers', async () => {
    const { OPTIONS } = await import('./route')

    const response = OPTIONS()

    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET,OPTIONS')
  })
})
