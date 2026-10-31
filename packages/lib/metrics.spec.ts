import { expect } from 'chai'
import { createServer } from 'node:http'
import { vi } from 'vitest'

describe('metrics', function() {
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
})
