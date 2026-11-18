import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  add, getBlockTime, getDefaultStartBlockNumber, getLogs, loadAbi, query,
  resolveHooks, rpcsNext, hookDefault, blacklistEvents
} = vi.hoisted(() => {
  type RpcEvent = { type: string, name: string }
  type RpcOptions = { address: string, events: RpcEvent[], fromBlock: bigint, toBlock: bigint }
  type RpcLog = {
    address: string
    eventName: string
    topics: string[]
    data: string
    args: Record<string, unknown>
    blockNumber: bigint
    logIndex: number
    transactionHash: string
    transactionIndex: number
  }
  const hookDefault = vi.fn(async (_chainId: number, _address: string, data: { blockTime?: bigint }) => ({ seenBlockTime: data.blockTime }))
  const hook = { type: 'event', abiPath: 'test', module: { topics: ['0xaaaa'], default: hookDefault } }
  const resolveHooks = vi.fn(() => [hook])
  const blacklistEvents = { ignore: ['Ignored'], limit: ['Limited'] }
  const getLogs = vi.fn<(options: RpcOptions) => Promise<RpcLog[]>>()
  return {
    add: vi.fn<(job: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void>>(),
    getBlockTime: vi.fn<(chainId: number, blockNumber?: bigint) => Promise<bigint>>(async () => 0n),
    getDefaultStartBlockNumber: vi.fn<(chainId: number) => Promise<bigint>>(async () => 10n),
    getLogs,
    loadAbi: vi.fn<() => Promise<RpcEvent[]>>(),
    query: vi.fn<(sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(),
    resolveHooks,
    rpcsNext: vi.fn<(chainId: number, blockNumber?: bigint) => { getLogs: typeof getLogs }>(() => ({ getLogs })),
    hookDefault,
    blacklistEvents
  }
})

vi.mock('lib', () => ({
  math: { div: (a: bigint, b: bigint) => Number(a) / Number(b) },
  mq: { LOWEST_PRIORITY: -1, add, job: { load: { evmlog: 'load:evmlog' } } }
}))
vi.mock('lib/blocks', () => ({ getBlockTime, getDefaultStartBlockNumber }))
vi.mock('lib/blacklist', () => ({ default: { events: blacklistEvents, addresses: [] } }))
vi.mock('../rpcs', () => ({ rpcs: { next: rpcsNext } }))
vi.mock('../db', () => ({ default: { query } }))
vi.mock('../abis', () => ({ requireHooks: vi.fn(async () => resolveHooks) }))
vi.mock('../abiutil', () => ({
  default: {
    load: loadAbi,
    events: (abi: unknown[]) => abi,
    exclude: (names: string[], events: { name: string }[]) => events.filter(event => !names.includes(event.name))
  }
}))
vi.mock('../abis/yearn/lib', () => ({ safeFetchOrExtractDecimals: vi.fn() }))

import { EvmLogsExtractor } from './evmlogs'

const ADDRESS = '0x1111111111111111111111111111111111111111'
const BASE_LOG = {
  address: ADDRESS,
  eventName: 'Regular',
  topics: ['0xaaaa'],
  data: '0x',
  args: { label: 'test' },
  blockNumber: 8n,
  logIndex: 0,
  transactionHash: '0xbbbb',
  transactionIndex: 0
}

function event(name: string) {
  return { type: 'event', name }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadAbi.mockResolvedValue([event('Regular'), event('Limited'), event('Ignored')])
  getBlockTime.mockResolvedValue(0n)
  getDefaultStartBlockNumber.mockResolvedValue(10n)
  getLogs.mockImplementation(async ({ fromBlock }: { fromBlock: bigint }) => [{
    ...BASE_LOG,
    blockNumber: fromBlock,
    eventName: fromBlock < 10n ? 'Regular' : 'Limited'
  }])
  query.mockResolvedValue({ rows: [] })
})

describe('EvmLogsExtractor RPC avoidance and timestamps', () => {
  it('skips getLogs for a fresh ABI with no eligible events and still enqueues the checkpoint batch', async () => {
    loadAbi.mockResolvedValue([event('Ignored')])
    await new EvmLogsExtractor().extract({ abiPath: 'test', chainId: 1, address: ADDRESS, from: 1n, to: 9n })

    expect(getDefaultStartBlockNumber).not.toHaveBeenCalled()
    expect(rpcsNext).not.toHaveBeenCalled()
    expect(getLogs).not.toHaveBeenCalled()
    expect(add).toHaveBeenCalledWith('load:evmlog', {
      chainId: 1,
      address: ADDRESS,
      from: 1n,
      to: 9n,
      batch: []
    }, { priority: -1 })
  })

  it('splits a fresh range at the default start so limited events remain eligible afterward', async () => {
    await new EvmLogsExtractor().extract({ abiPath: 'test', chainId: 1, address: ADDRESS, from: 8n, to: 12n })

    expect(getLogs).toHaveBeenCalledTimes(2)
    expect(getLogs.mock.calls.map(([options]) => ({
      fromBlock: options.fromBlock,
      toBlock: options.toBlock,
      events: options.events.map((entry: { name: string }) => entry.name)
    }))).toEqual([
      { fromBlock: 8n, toBlock: 9n, events: ['Regular'] },
      { fromBlock: 10n, toBlock: 12n, events: ['Regular', 'Limited'] }
    ])
    expect(getBlockTime.mock.calls).toEqual([[1, 8n], [1, 10n]])
    expect(hookDefault.mock.calls.map(([, , data]) => data.blockTime)).toEqual([0n, 0n])
    const payload = add.mock.calls[0]![1] as { batch: { blockNumber: bigint, blockTime: bigint, hook: object }[] }
    expect(payload.batch.map(log => [log.blockNumber, log.blockTime, log.hook])).toEqual([
      [8n, 0n, { seenBlockTime: 0n }],
      [10n, 0n, { seenBlockTime: 0n }]
    ])
  })

  it('looks up the timestamp for fresh block zero instead of treating it as the head', async () => {
    loadAbi.mockResolvedValue([event('Regular')])
    getLogs.mockResolvedValue([{ ...BASE_LOG, blockNumber: 0n }])
    await new EvmLogsExtractor().extract({ abiPath: 'test', chainId: 1, address: ADDRESS, from: 0n, to: 0n })

    expect(getBlockTime).toHaveBeenCalledWith(1, 0n)
    expect(getBlockTime).not.toHaveBeenCalledWith(1, undefined)
  })

  it('reuses the stored replay timestamp, including zero, without ABI, cutoff, or RPC lookups', async () => {
    const storedLog = {
      chainId: 1,
      ...BASE_LOG,
      eventName: 'Regular',
      signature: '0xaaaa',
      args: { label: 'test' },
      hook: {},
      blockNumber: 0n,
      blockTime: 0n
    }
    query.mockResolvedValue({ rows: [storedLog] })
    await new EvmLogsExtractor().extract({ abiPath: 'test', chainId: 1, address: ADDRESS, from: 0n, to: 0n, replay: true })

    expect(loadAbi).not.toHaveBeenCalled()
    expect(getDefaultStartBlockNumber).not.toHaveBeenCalled()
    expect(getBlockTime).not.toHaveBeenCalled()
    expect(rpcsNext).not.toHaveBeenCalled()
    expect(hookDefault.mock.calls[0][2].blockTime).toBe(0n)
    const payload = add.mock.calls[0]![1] as { batch: { blockTime: bigint }[] }
    expect(payload.batch[0].blockTime).toBe(0n)
  })
})
