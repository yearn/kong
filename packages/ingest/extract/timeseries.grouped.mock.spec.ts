import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mqAdd, singleHook, processGroup, hooks } = vi.hoisted(() => {
  const singleHook = vi.fn(async (_chainId: number, _address: `0x${string}`, _data: unknown) => [])
  const processGroup = vi.fn(async (_chainId: number, _address: `0x${string}`, _data: unknown, _labels: string[]) => [])
  return {
    mqAdd: vi.fn(async () => undefined),
    singleHook,
    processGroup,
    hooks: [
      {
        type: 'timeseries', abiPath: 'yearn/3/vault',
        module: {
          outputLabel: 'tvl', default: singleHook,
          outputGroup: { key: 'yearn-tvl', labels: ['tvl', 'tvl-c'], process: processGroup }
        }
      },
      {
        type: 'timeseries', abiPath: 'yearn/3/vault',
        module: {
          outputLabel: 'tvl-c', default: singleHook,
          outputGroup: { key: 'yearn-tvl', labels: ['tvl', 'tvl-c'], process: processGroup }
        }
      }
    ] as any[]
  }
})

vi.mock('lib', () => ({
  mq: { add: mqAdd, job: { load: { output: { queue: 'load', name: 'output' } } } }
}))

vi.mock('../abis', () => ({
  requireHooks: vi.fn(async () => () => hooks)
}))

import { TimeseriesExtractor } from './timeseries'

const DATA = {
  abiPath: 'yearn/3/vault',
  chainId: 1,
  address: '0x1111111111111111111111111111111111111111' as const,
  outputLabel: 'tvl',
  blockTime: 1700000000n
}

describe('extract/timeseries grouped jobs', () => {
  beforeEach(() => {
    mqAdd.mockClear()
    singleHook.mockClear()
    processGroup.mockClear()
  })

  it('runs a grouped processor for only the requested output labels', async () => {
    const extractor = new TimeseriesExtractor()
    await extractor.extract({ ...DATA, outputLabels: ['tvl', 'tvl-c'] })

    expect(processGroup).toHaveBeenCalledTimes(1)
    expect(processGroup.mock.calls[0][3]).to.deep.equal(['tvl', 'tvl-c'])
    expect(singleHook).not.toHaveBeenCalled()
    expect(mqAdd).toHaveBeenCalledTimes(1)
  })

  it('executes persisted legacy jobs that have only outputLabel', async () => {
    const extractor = new TimeseriesExtractor()
    await extractor.extract(DATA)

    expect(singleHook).toHaveBeenCalledTimes(1)
    expect(processGroup).not.toHaveBeenCalled()
    expect(mqAdd).toHaveBeenCalledTimes(1)
  })
})
