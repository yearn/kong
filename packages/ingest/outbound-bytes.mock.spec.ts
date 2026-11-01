import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createPublicClient, defineChain } from 'viem'
import type { Chain } from 'viem/chains'

const { countMetric } = vi.hoisted(() => ({ countMetric: vi.fn() }))
vi.mock('lib/metrics', () => ({ countMetric }))

import { rpcHttp } from 'lib/rpc-observability'

type RequestHandler = (res: import('node:http').ServerResponse, body: string, requestNumber: number) => void
const servers: Server[] = []

async function localServer(handle: RequestHandler) {
  let requestNumber = 0
  const bodies: string[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      bodies.push(body)
      handle(res, body, ++requestNumber)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as { port: number }
  return { server, endpoint: `http://127.0.0.1:${address.port}/rpc`, bodies }
}

function sendRpcResponse(res: import('node:http').ServerResponse, body: string) {
  const request = JSON.parse(body)
  const requests = Array.isArray(request) ? request : [request]
  const responses = requests.map((entry: { id: number }) => ({
    jsonrpc: '2.0', id: entry.id, result: '0x1'
  }))
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(Array.isArray(request) ? responses : responses[0]))
}

function client(endpoint: string, batchSize = 2, wait = 10, chain: Chain = defineChain({
  id: 90001,
  name: 'local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [endpoint] } }
})) {
  return createPublicClient({
    chain,
    transport: rpcHttp(endpoint, { batch: { batchSize, wait }, retryCount: 1, retryDelay: 1 }, chain.id, false)
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  vi.unstubAllEnvs()
  countMetric.mockReset()
})

describe('outbound HTTP payload accounting', function() {
  it('counts actual batch and retry envelopes with exact serialized body bytes', async function() {
    vi.stubEnv('OUTBOUND_BYTES_METRICS', 'true')
    vi.stubEnv('RPC_METRICS', 'false')
    const endpoint = await localServer((res, body, requestNumber) => {
      if (requestNumber === 1) {
        res.statusCode = 503
        res.end('retry')
        return
      }
      sendRpcResponse(res, body)
    })
    const rpc = client(`${endpoint.endpoint}?api_key=do-not-export`)

    expect(await Promise.all([
      rpc.request({ method: 'eth_blockNumber' }),
      rpc.request({ method: 'eth_chainId' })
    ])).to.deep.equal(['0x1', '0x1'])

    const envelopes = countMetric.mock.calls.filter(call => call[0] === 'outbound.http_envelopes')
    const byteCounters = countMetric.mock.calls.filter(call => call[0] === 'outbound.payload_bytes')
    expect(envelopes).to.have.length(endpoint.bodies.length)
    expect(byteCounters).to.have.length(endpoint.bodies.length)
    expect(envelopes.every(call => call[1] === 1 && call[2].destination === 'rpc')).to.equal(true)
    expect(byteCounters.every(call => call[2].destination === 'rpc')).to.equal(true)
    // The diagnostics channel reports the contentLength of the same final JSON body received here.
    expect(byteCounters.reduce((sum, call) => sum + call[1], 0)).to.equal(
      endpoint.bodies.reduce((sum, body) => sum + Buffer.byteLength(body), 0)
    )
    expect(JSON.stringify(countMetric.mock.calls)).not.to.contain('do-not-export')
  })

  it('keeps chain default RPC URLs in separate batches', async function() {
    vi.stubEnv('OUTBOUND_BYTES_METRICS', 'true')
    vi.stubEnv('RPC_METRICS', 'false')
    const firstBodies: string[] = []
    const secondBodies: string[] = []
    const first = await localServer((res, body) => { firstBodies.push(body); sendRpcResponse(res, body) })
    const second = await localServer((res, body) => { secondBodies.push(body); sendRpcResponse(res, body) })
    const firstChain = defineChain({
      id: 90002,
      name: 'local-one',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [first.endpoint] } }
    })
    const secondChain = defineChain({
      id: 90003,
      name: 'local-two',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [second.endpoint] } }
    })
    const firstClient = client('', 2, 20, firstChain)
    const secondClient = client('', 2, 20, secondChain)

    await Promise.all([
      firstClient.request({ method: 'eth_blockNumber' }),
      secondClient.request({ method: 'eth_blockNumber' })
    ])

    expect(firstBodies).to.have.length(1)
    expect(secondBodies).to.have.length(1)
    expect(JSON.parse(firstBodies[0])).to.have.length(1)
    expect(JSON.parse(secondBodies[0])).to.have.length(1)
  })

  it('ignores undici requests to unregistered endpoints', async function() {
    vi.stubEnv('OUTBOUND_BYTES_METRICS', 'true')
    vi.stubEnv('RPC_METRICS', 'false')
    const registered = await localServer((res, body) => sendRpcResponse(res, body))
    const unregistered = await localServer((res, body) => sendRpcResponse(res, body))
    await client(registered.endpoint).request({ method: 'eth_blockNumber' })
    countMetric.mockClear()

    await fetch(unregistered.endpoint, { method: 'POST', body: '{"not":"rpc"}' })

    expect(countMetric).not.toHaveBeenCalled()
  })

  it('warns once without leaking the URL when the endpoint cap is hit', async function() {
    vi.stubEnv('OUTBOUND_BYTES_METRICS', 'true')
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { observeRpcEndpoint } = await import('lib/outbound-bytes')
    for (let i = 0; i < 70; i++) observeRpcEndpoint(`http://127.0.0.1:1/rpc?api_key=secret-${i}`)
    expect(warn.mock.calls).to.have.length(1)
    expect(JSON.stringify(warn.mock.calls)).not.to.contain('secret')
    warn.mockRestore()
  })

  it('does not let telemetry callback failures affect RPC results', async function() {
    vi.stubEnv('OUTBOUND_BYTES_METRICS', 'true')
    vi.stubEnv('RPC_METRICS', 'false')
    const endpoint = await localServer((res, body) => sendRpcResponse(res, body))
    countMetric.mockImplementation(() => { throw new Error('metrics unavailable') })

    await expect(client(endpoint.endpoint).request({ method: 'eth_blockNumber' })).resolves.toBe('0x1')
  })
})
