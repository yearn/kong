import { AsyncLocalStorage } from 'node:async_hooks'
import { createTransport, http, type HttpTransport, type HttpTransportConfig } from 'viem'
import { countMetric } from './sentry'

const callers = new Set([
  'fanout.abis', 'fanout.events', 'fanout.timeseries',
  'extract.block', 'extract.evmlog', 'extract.snapshot', 'extract.timeseries', 'extract.manuals', 'extract.webhook',
  'load.block', 'load.output', 'load.monitor', 'load.evmlog', 'load.snapshot', 'load.thing',
  'probe.all'
])
const methods = new Set(['eth_call', 'eth_getLogs', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getCode', 'eth_getBalance', 'eth_getStorageAt', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_chainId'])
const callerContext = new AsyncLocalStorage<string>()

export function withRpcCaller<T>(caller: string, fn: () => Promise<T>): Promise<T> {
  return callerContext.run(callers.has(caller) ? caller : 'other', fn)
}

function logRange(params: unknown): string {
  const filter = Array.isArray(params) ? params[0] : undefined
  if (!filter || !/^0x[0-9a-f]+$/i.test(filter.fromBlock) || !/^0x[0-9a-f]+$/i.test(filter.toBlock)) return 'tagged'
  const size = BigInt(filter.toBlock) - BigInt(filter.fromBlock) + 1n
  return size <= 100n ? '1-100' : size <= 1000n ? '101-1000' : size <= 10000n ? '1001-10000' : '10001+'
}

// Instrument the raw HTTP transport request, inside viem's existing retry loop.
// No endpoint URLs, addresses, calldata, exact ranges, or error messages are tags.
// These are attempted JSON-RPC calls, not HTTP envelopes or provider-billed RUs.
export function rpcHttp(url: string | undefined, config: HttpTransportConfig, chainId: number, archive: boolean): HttpTransport {
  const factory = http(url, config)
  return options => {
    const transport = factory(options)
    if (process.env.RPC_METRICS !== 'true') return transport
    const attempts = new AsyncLocalStorage<{ count: number }>()
    const metric = (name: string, value: number, tags: Record<string, string>) => {
      try { countMetric(name, value, tags) } catch { /* telemetry must not fail RPC */ }
    }
    const observed = createTransport({
      ...transport.config,
      request: (async args => {
        const attempt = attempts.getStore()
        const retry = attempt ? attempt.count++ > 0 : false
        const tags = {
          chainId: String(chainId),
          provider: url ? (archive ? 'configured_archive' : 'configured_full') : 'chain_default',
          caller: callerContext.getStore() ?? 'unattributed',
          method: methods.has(args.method) ? args.method : 'other',
          retry: String(retry),
          cache: 'unknown',
          range: args.method === 'eth_getLogs' ? logRange(args.params) : 'none'
        }
        const start = performance.now()
        let outcome = 'error'
        try {
          const result = await transport.config.request(args)
          outcome = 'success'
          return result
        } finally {
          metric('rpc.attempt', 1, { ...tags, outcome })
          metric('rpc.duration_ms_total', performance.now() - start, { ...tags, outcome })
        }
      }) as typeof transport.config.request
    }, transport.value)
    return {
      ...observed,
      request: (args, overrides) => attempts.run({ count: 0 }, () => observed.request(args, overrides))
    }
  }
}
