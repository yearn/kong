import { describe, expect, it, vi } from 'vitest'
import type { AbiHook } from '../abis/types'

const { queryMock, mqAdd, hooks, sharedProcessor, blockTimes } = vi.hoisted(() => {
  process.env.TVL_GROUPED_JOBS = 'false'
  const sharedProcessor = vi.fn(async () => [])
  const hooks = ['tvl', 'tvl-c'].map(outputLabel => ({
    type: 'timeseries',
    abiPath: 'yearn/3/vault',
    module: {
      outputLabel,
      default: vi.fn(),
      outputGroup: { key: 'yearn-tvl', labels: ['tvl', 'tvl-c'], process: sharedProcessor }
    }
  })) as AbiHook[]
  return {
    queryMock: vi.fn<(query: string, params: unknown[]) => Promise<{ rows: { day: string }[] }>>(async () => ({ rows: [] })),
    mqAdd: vi.fn<(job: unknown, data: Record<string, unknown>, options: unknown) => Promise<void>>(async () => undefined),
    hooks,
    sharedProcessor,
    blockTimes: { '1': 1704153599n, '3': 1704326399n } as Record<string, bigint>
  }
})

vi.mock('../db', () => ({ default: { query: queryMock } }))
vi.mock('lib', () => ({
  math: { max: (...args: bigint[]) => args.reduce((a, b) => a > b ? a : b) },
  mq: {
    add: mqAdd,
    job: { extract: { timeseries: { queue: 'extract', name: 'timeseries' } } }
  },
  multicall3: { getActivation: vi.fn(() => 0n) }
}))
vi.mock('lib/blocks', () => ({
  getBlockNumber: vi.fn(async () => 3n),
  getBlockTime: vi.fn(async (_chainId: number, blockNumber: bigint) => blockTimes[blockNumber.toString()]),
  getDefaultStartBlockNumber: vi.fn(async () => 0n)
}))
vi.mock('../abis', () => ({ requireHooks: vi.fn(async () => () => hooks) }))

import TimeseriesFanout from './timeseries'

describe('TimeseriesFanout with grouped jobs disabled', () => {
  it('keeps group-declared hooks on the legacy per-label job shape', async () => {
    const fanout = new TimeseriesFanout()
    await fanout.fanout({
      abi: { abiPath: 'yearn/3/vault', sources: [], skip: false, only: false },
      source: {
        chainId: 1,
        address: '0x1111111111111111111111111111111111111111',
        inceptBlock: 0n,
        skip: false,
        only: false,
        startBlock: 1n,
        endBlock: 3n
      }
    })

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(mqAdd).toHaveBeenCalledTimes(2)
    expect(mqAdd.mock.calls.map(call => call[1].outputLabel)).to.deep.equal(['tvl', 'tvl-c'])
    expect(mqAdd.mock.calls.every(call => !('outputLabels' in call[1]))).to.equal(true)
    expect(sharedProcessor).not.toHaveBeenCalled()
  })
})
