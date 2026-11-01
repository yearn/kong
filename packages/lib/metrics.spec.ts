import { expect } from 'chai'
import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { vi } from 'vitest'
import { metricExportIntervalMillis } from './metrics'

describe('metrics', function() {
  it('validates and bounds the configurable export interval', function() {
    expect(metricExportIntervalMillis(undefined)).to.equal(60_000)
    expect(metricExportIntervalMillis('10000')).to.equal(10_000)
    expect(metricExportIntervalMillis('300000')).to.equal(300_000)
    expect(metricExportIntervalMillis('9999')).to.equal(10_000)
    expect(metricExportIntervalMillis('0')).to.equal(10_000)
    expect(metricExportIntervalMillis('300001')).to.equal(300_000)
    expect(metricExportIntervalMillis('99999999999999999999')).to.equal(300_000)
    expect(metricExportIntervalMillis('1e4')).to.equal(60_000)
    expect(metricExportIntervalMillis('nope')).to.equal(60_000)
  })

  it('prefers OTEL_METRIC_EXPORT_INTERVAL over the _MS fallback', function() {
    vi.stubEnv('OTEL_METRIC_EXPORT_INTERVAL', '20000')
    vi.stubEnv('OTEL_METRIC_EXPORT_INTERVAL_MS', '30000')
    expect(metricExportIntervalMillis()).to.equal(20_000)
    vi.unstubAllEnvs()
    vi.stubEnv('OTEL_METRIC_EXPORT_INTERVAL_MS', '30000')
    expect(metricExportIntervalMillis()).to.equal(30_000)
    vi.unstubAllEnvs()
  })

  it('exports counters to the OTLP endpoint', async function() {
    const bodies: string[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', () => { bodies.push(`${req.url} ${req.headers.authorization} ${body}`); res.end('{}') })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', `http://127.0.0.1:${port}/otel/v1/metrics`)
    vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_HEADERS', 'Authorization=Basic%20abc')
    vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_PROTOCOL', 'http/json')
    vi.resetModules()
    const { countMetric, flush } = await import('./metrics')
    countMetric('rpc.attempt', 2, { chainId: '1' })
    await flush()
    server.close()
    vi.unstubAllEnvs()
    expect(bodies).to.have.length(1)
    expect(bodies[0]).to.contain('/otel/v1/metrics Basic abc')
    expect(bodies[0]).to.contain('rpc.attempt')
  })

  it('opts into gzip OTLP requests only when configured', async function() {
    const requests: { encoding: string | undefined; body: Buffer }[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        requests.push({ encoding: req.headers['content-encoding'], body: Buffer.concat(chunks) })
        res.end('{}')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', `http://127.0.0.1:${port}/otel/v1/metrics`)
    vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_COMPRESSION', 'gzip')
    vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_PROTOCOL', 'http/json')
    vi.resetModules()
    const { countMetric, flush } = await import('./metrics')
    countMetric('rpc.attempt', 1, { chainId: '1' })
    await flush()
    server.close()
    vi.unstubAllEnvs()

    expect(requests).to.have.length(1)
    expect(requests[0].encoding).to.equal('gzip')
    expect(gunzipSync(requests[0].body).toString()).to.contain('rpc.attempt')
  })
})
