import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryMock, mqAdd, getBlockTime, decimals, inflight } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  mqAdd: vi.fn(async () => undefined),
  getBlockTime: vi.fn(),
  decimals: vi.fn(async () => ({ success: true, error: undefined, decimals: 18 })),
  inflight: { current: 0, max: 0 }
}))

vi.mock('../db', () => ({ default: { query: queryMock } }))

vi.mock('lib', () => ({
  math: { div: (a: bigint, b: bigint) => Number(a) / Number(b) },
  mq: {
    add: mqAdd,
    LOWEST_PRIORITY: 2 ** 21,
    job: { load: { evmlog: { queue: 'load', name: 'evmlog' } } }
  }
}))

vi.mock('lib/blocks', () => ({
  getBlockTime,
  getDefaultStartBlockNumber: vi.fn(async () => 0n)
}))

vi.mock('../rpcs', () => ({ rpcs: { next: vi.fn() } }))
vi.mock('../abis', () => ({ requireHooks: vi.fn(async () => () => []) }))
vi.mock('../abiutil', () => ({ default: { load: vi.fn(async () => []), events: vi.fn(() => []), exclude: vi.fn(() => []) } }))
vi.mock('../abis/yearn/lib', () => ({ safeFetchOrExtractDecimals: decimals }))

import { EvmLogsExtractor } from './evmlogs'

const ADDRESS = '0x1111111111111111111111111111111111111111'

function logRow(blockNumber: number, logIndex: number) {
  return {
    chainId: 1, address: ADDRESS, eventName: 'Transfer', signature: '0xaa', topics: ['0xaa'],
    args: { value: '1000000000000000000' }, hook: {},
    blockNumber, blockTime: 0, logIndex, transactionHash: '0xbb', transactionIndex: 0
  }
}

async function run(rows: ReturnType<typeof logRow>[], extractor = new EvmLogsExtractor()) {
  queryMock.mockResolvedValue({ rows })
  await extractor.extract({ abiPath: 'x', chainId: 1, address: ADDRESS, from: 0n, to: 100n, replay: true })
}

describe('extract/evmlogs', () => {
  beforeEach(() => {
    decimals.mockClear()
    mqAdd.mockClear()
    getBlockTime.mockReset()
    inflight.current = 0
    inflight.max = 0
    getBlockTime.mockImplementation(async (_chainId: number, blockNumber: bigint) => {
      inflight.current++
      inflight.max = Math.max(inflight.max, inflight.current)
      await new Promise(resolve => setTimeout(resolve, 5))
      inflight.current--
      return blockNumber * 10n
    })
  })

  it('resolves decimals once per job', async () => {
    await run(Array.from({ length: 5 }, (_, i) => logRow(1 + i, i)))
    expect(decimals).toHaveBeenCalledTimes(1)
    expect(mqAdd).toHaveBeenCalledTimes(1)
  })

  it('retries decimals after a failure so later logs are still filtered', async () => {
    decimals.mockResolvedValueOnce({ success: false, error: new Error('rpc'), decimals: undefined } as any)
    const small = { ...logRow(2, 1), args: { value: '1' } }
    await run([logRow(1, 0), small])
    expect(decimals).toHaveBeenCalledTimes(2)
    const batch = (mqAdd.mock.calls[0] as any)[1].batch
    expect(batch.map((l: any) => l.logIndex)).toEqual([0])
  })

  it('looks up each block once without speculative requests', async () => {
    await run(Array.from({ length: 40 }, (_, i) => logRow(1 + (i % 20), i)))
    expect(getBlockTime).toHaveBeenCalledTimes(20)
    expect(inflight.max).toBe(1)
    expect(inflight.current).toBe(0)
  })

  it('stops before later hook side effects when a timestamp lookup fails', async () => {
    const failure = new Error('archive unavailable')
    const sideEffects: bigint[] = []
    const extractor = new EvmLogsExtractor()
    extractor.resolveHooks = () => [{
      type: 'event', abiPath: 'x', module: {
        topics: ['0xaa'],
        default: async (_chainId, _address, log) => {
          sideEffects.push(log.blockNumber)
          return {}
        }
      }
    }]
    getBlockTime.mockRejectedValue(failure)
    await expect(run([logRow(1, 0), logRow(2, 1)], extractor)).rejects.toBe(failure)
    expect(sideEffects).toEqual([1n])
    expect(getBlockTime).toHaveBeenCalledTimes(1)
    expect(inflight.current).toBe(0)
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('resolves each timestamp between consecutive hook side effects', async () => {
    const order: string[] = []
    const extractor = new EvmLogsExtractor()
    extractor.resolveHooks = () => [{
      type: 'event', abiPath: 'x', module: {
        topics: ['0xaa'],
        default: async (_chainId, _address, log) => {
          order.push(`hook-${log.blockNumber}`)
          return {}
        }
      }
    }]
    getBlockTime.mockImplementation(async (_chainId, block) => {
      order.push(`time-${block}`)
      return block * 10n
    })
    await run([logRow(1, 0), logRow(2, 1)], extractor)
    expect(order).toEqual(['hook-1', 'time-1', 'hook-2', 'time-2'])
  })

  it('skips block lookups for dropped logs', async () => {
    await run([logRow(1, 0), { ...logRow(2, 1), args: { value: '1' } }])
    expect(getBlockTime).toHaveBeenCalledTimes(1)
    expect(mqAdd).toHaveBeenCalledTimes(1)
  })
})
