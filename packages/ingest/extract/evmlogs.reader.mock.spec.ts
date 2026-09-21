import { describe, expect, it, vi } from 'vitest'

type LoadPayload = {
  abiPath: string
  chainId: number
  address: string
  from: bigint
  to: bigint
  replay?: boolean
  batch: Array<{ eventName: string }>
}

type AddCall = (
  job: unknown,
  data: LoadPayload,
  options?: { priority?: number }
) => Promise<void>

const {
  abiLoad,
  abiEvents,
  abiExclude,
  getLogs,
  rpcNext,
  dbQuery,
  mqAdd,
  resolveHooks,
  requireHooks,
  getBlockTime,
  getDefaultStartBlockNumber,
  safeFetchOrExtractDecimals
} = vi.hoisted(() => ({
  abiLoad: vi.fn(async () => [{ name: 'StrategyChanged', type: 'event' }]),
  abiEvents: vi.fn((abi: unknown) => abi),
  abiExclude: vi.fn((_excluded: string[], events: unknown) => events),
  getLogs: vi.fn(async () => [{
    address: '0x1111111111111111111111111111111111111111',
    eventName: 'StrategyChanged',
    topics: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    args: {},
    blockNumber: 10n,
    logIndex: 0,
    transactionHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    transactionIndex: 0
  }]),
  rpcNext: vi.fn(() => ({ getLogs })),
  dbQuery: vi.fn(async () => ({ rows: [{
    chainId: 1,
    address: '0x1111111111111111111111111111111111111111',
    eventName: 'StrategyChanged',
    signature: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    topics: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    args: {},
    hook: {},
    blockNumber: 10n,
    blockTime: 1000n,
    logIndex: 0,
    transactionHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    transactionIndex: 0
  }] })),
  mqAdd: vi.fn<AddCall>(async () => undefined),
  resolveHooks: vi.fn(() => []),
  requireHooks: vi.fn(async () => resolveHooks),
  getBlockTime: vi.fn(async () => 1000n),
  getDefaultStartBlockNumber: vi.fn(async () => 0n),
  safeFetchOrExtractDecimals: vi.fn(async () => ({ success: false }))
}))

vi.mock('lib', () => ({
  math: { div: vi.fn() },
  mq: {
    add: mqAdd,
    LOWEST_PRIORITY: 123,
    job: { load: { evmlog: { queue: 'load', name: 'evmlog' } } }
  }
}))

vi.mock('lib/blocks', () => ({ getBlockTime, getDefaultStartBlockNumber }))
vi.mock('lib/blacklist', () => ({
  default: { events: { ignore: [], limit: [] }, addresses: [] }
}))
vi.mock('../rpcs', () => ({
  rpcs: { next: rpcNext }
}))
vi.mock('../db', () => ({ default: { query: dbQuery } }))
vi.mock('../abiutil', () => ({ default: { load: abiLoad, events: abiEvents, exclude: abiExclude } }))
vi.mock('../abis', () => ({ requireHooks }))
vi.mock('../abis/yearn/lib', () => ({ safeFetchOrExtractDecimals }))

import { EvmLogsExtractor } from './evmlogs'

describe('extract/evmlogs reader identity', () => {
  it('propagates the Yearn reader identity to the load job', async () => {
    getLogs.mockClear()
    mqAdd.mockClear()
    const extractor = new EvmLogsExtractor()

    await extractor.extract({
      abiPath: 'yearn/3/vault',
      chainId: 1,
      address: '0x1111111111111111111111111111111111111111',
      from: 10n,
      to: 20n
    })

    expect(abiLoad).toHaveBeenCalledWith('yearn/3/vault')
    expect(resolveHooks).toHaveBeenCalledWith('yearn/3/vault', 'event')
    expect(abiEvents).toHaveBeenCalledWith([{ name: 'StrategyChanged', type: 'event' }])
    expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ name: 'StrategyChanged' })]
    }))
    const loadPayload = mqAdd.mock.calls[0]?.[1]
    expect(loadPayload).toMatchObject({
      abiPath: 'yearn/3/vault',
      chainId: 1,
      address: '0x1111111111111111111111111111111111111111',
      from: 10n,
      to: 20n,
      replay: undefined
    })
    expect(loadPayload?.batch).toHaveLength(1)
    expect(loadPayload?.batch[0]?.eventName).to.equal('StrategyChanged')
  })

  it('passes replay through to loading without requesting RPC logs', async () => {
    rpcNext.mockClear()
    dbQuery.mockClear()
    mqAdd.mockClear()

    await new EvmLogsExtractor().extract({
      abiPath: 'yearn/3/vault',
      chainId: 1,
      address: '0x1111111111111111111111111111111111111111',
      from: 10n,
      to: 20n,
      replay: true
    })

    expect(rpcNext).not.toHaveBeenCalled()
    expect(dbQuery).toHaveBeenCalled()
    expect(mqAdd.mock.calls[0]?.[1]).toMatchObject({
      abiPath: 'yearn/3/vault',
      replay: true
    })
  })
})
