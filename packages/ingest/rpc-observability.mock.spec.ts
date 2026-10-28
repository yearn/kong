import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPublicClient } from 'viem'
import { mainnet } from 'viem/chains'
const { countMetric } = vi.hoisted(() => ({ countMetric: vi.fn() }))
vi.mock('lib/sentry', () => ({ countMetric }))
import { rpcHttp, withRpcCaller } from 'lib/rpc-observability'
const endpoint = 'https://private.invalid/secret'
const fetchMock = vi.fn()
function jsonResponse(body: unknown) { return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }) }
function response(result: unknown = '0x1') { return jsonResponse({ jsonrpc: '2.0', id: 1, result }) }
function client(batch = false) {
  return createPublicClient({ chain: mainnet, transport: rpcHttp(endpoint, { retryCount: 1, retryDelay: 1, batch }, 1, true) })
}
beforeEach(() => {
  vi.stubEnv('RPC_METRICS', 'true')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(async () => response())
  countMetric.mockReset()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const attempts = () => countMetric.mock.calls.filter(call => call[0] === 'rpc.attempt')
describe('RPC attempt metrics', () => {
  it('counts actual retries and preserves caller attribution without endpoint data', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await withRpcCaller('snapshot', () => client().getBlockNumber())).toBe(1n)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(attempts().map(call => call[2])).toEqual([
      expect.objectContaining({ chainId: '1', caller: 'snapshot', retry: 'false', outcome: 'error' }),
      expect.objectContaining({ caller: 'snapshot', retry: 'true', outcome: 'success' })
    ])
    expect(JSON.stringify(countMetric.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(countMetric.mock.calls)).not.toContain('private.invalid')
  })
  it('does not add retries to permanent JSON-RPC errors', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad params' } }))
    await expect(client().getBlockNumber()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(1)
  })
  it('counts each batch member rather than one HTTP envelope', async () => {
    fetchMock.mockImplementation(async (_url, options) => jsonResponse(JSON.parse(options.body).map((entry: { id: number }) => ({ jsonrpc: '2.0', id: entry.id, result: '0x1' }))))
    const rpc = client(true)
    expect(await Promise.all([rpc.request({ method: 'eth_blockNumber' }), rpc.request({ method: 'eth_chainId' })])).toEqual(['0x1', '0x1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(2)
  })
  it('bounds caller and range dimensions and preserves concurrent caller context', async () => {
    const rpc = client()
    fetchMock.mockImplementation(async (_url, options) => response(JSON.parse(options.body).method === 'eth_getLogs' ? [] : '0x1'))
    await Promise.all([
      withRpcCaller('evmlog', () => rpc.request({ method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x2710' }] })),
      withRpcCaller('user-controlled-address', () => rpc.request({ method: 'eth_blockNumber' }))
    ])
    expect(attempts().map(call => call[2])).toEqual(expect.arrayContaining([
      expect.objectContaining({ caller: 'evmlog', range: '1001-10000' }),
      expect.objectContaining({ caller: 'other', range: 'none' })
    ]))
  })
  it('is disabled by default and telemetry errors do not change results', async () => {
    vi.stubEnv('RPC_METRICS', 'false')
    expect(await client().getBlockNumber()).toBe(1n)
    expect(countMetric).not.toHaveBeenCalled()
    vi.stubEnv('RPC_METRICS', 'true')
    countMetric.mockImplementation(() => { throw new Error('metrics unavailable') })
    expect(await client().getBlockNumber()).toBe(1n)
  })
})
