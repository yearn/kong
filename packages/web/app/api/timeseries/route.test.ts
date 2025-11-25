import assert from 'assert'
import { NextRequest } from 'next/server'
import { getTimeseriesKey } from './redis'
import { GET, runtime, timeseriesKeyv } from './[segment]/[chainId]/[address]/route'

describe('timeseries edge route', function() {
  beforeEach(async function() {
    await timeseriesKeyv.clear()
  })

  it('exports edge runtime', function() {
    assert.strictEqual(runtime, 'edge')
  })

  it('returns 404 for unknown segment', async function() {
    const req = new NextRequest('http://localhost/api/timeseries/unknown/1/0xabc')
    const res = await GET(req, { params: { segment: 'unknown', chainId: '1', address: '0xabc' } })
    assert.strictEqual(res.status, 404)
  })

  it('returns default component when components query absent', async function() {
    const cacheKey = getTimeseriesKey('pps', 1, '0xabc')
    await timeseriesKeyv.set(cacheKey, JSON.stringify([
      { time: 1, component: 'humanized', value: 1 },
      { time: 1, component: 'raw', value: 2 },
    ]))

    const req = new NextRequest('http://localhost/api/timeseries/pps/1/0xABC')
    const res = await GET(req, { params: { segment: 'pps', chainId: '1', address: '0xABC' } })

    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-type')?.includes('application/json'), true)
    assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=900, s-maxage=900, stale-while-revalidate=600')
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*')
    assert.strictEqual(res.headers.get('access-control-allow-methods'), 'GET,OPTIONS')

    const body = await res.json()
    assert.deepStrictEqual(body, [{ time: 1, component: 'humanized', value: 1 }])
  })

  it('filters by requested components', async function() {
    const cacheKey = getTimeseriesKey('pps', 1, '0xabc')
    await timeseriesKeyv.set(cacheKey, JSON.stringify([
      { time: 1, component: 'humanized', value: 1 },
      { time: 1, component: 'raw', value: 2 },
      { time: 2, component: 'net', value: 3 },
    ]))

    const req = new NextRequest('http://localhost/api/timeseries/pps/1/0xabc?components=humanized&components=raw')
    const res = await GET(req, { params: { segment: 'pps', chainId: '1', address: '0xabc' } })
    const body = await res.json()

    body.sort((a: any, b: any) => a.component.localeCompare(b.component))
    assert.deepStrictEqual(body, [
      { time: 1, component: 'humanized', value: 1 },
      { time: 1, component: 'raw', value: 2 },
    ])
  })
})
