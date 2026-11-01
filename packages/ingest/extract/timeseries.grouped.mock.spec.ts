import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mqAdd, singleHook, processGroup, hooks, hookState } = vi.hoisted(() => {
  const singleHook = vi.fn<(chainId: number, address: `0x${string}`, data: unknown) => Promise<unknown[]>>(async () => [])
  const processGroup = vi.fn<(chainId: number, address: `0x${string}`, data: unknown, labels: string[]) => Promise<unknown[]>>(async () => [])
  const hooks = [
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
  ]
  return { mqAdd: vi.fn(async () => undefined), singleHook, processGroup, hooks, hookState: { hooks } }
})

vi.mock('lib', () => ({
  mq: { add: mqAdd, job: { load: { output: { queue: 'load', name: 'output' } } } }
}))

vi.mock('../abis', () => ({
  requireHooks: vi.fn(async () => () => hookState.hooks)
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
    processGroup.mockReset()
    processGroup.mockResolvedValue([])
    hookState.hooks = hooks
  })

  const grouped = { outputLabels: ['tvl', 'tvl-c'] }
  const output = (label: string, blockTime = DATA.blockTime) => ({
    chainId: 1, address: DATA.address, blockNumber: 1n, blockTime, label, component: 'tvl', value: 1
  })
  const hookWith = (outputLabel: string, outputGroup?: unknown) => ({
    type: 'timeseries', abiPath: DATA.abiPath, module: { outputLabel, default: singleHook, outputGroup }
  })

  it('rejects empty outputLabels', async () => {
    await expect(new TimeseriesExtractor().extract({ ...DATA, outputLabels: [] })).rejects.toThrow('invalid grouped outputLabels')
  })

  it('rejects outputLabels that omit outputLabel', async () => {
    await expect(new TimeseriesExtractor().extract({ ...DATA, outputLabels: ['tvl-c'] })).rejects.toThrow('invalid grouped outputLabels')
  })

  it('rejects a grouped label that has no hook', async () => {
    await expect(new TimeseriesExtractor().extract({ ...DATA, outputLabels: ['tvl', 'missing'] })).rejects.toThrow('!hook, missing')
  })

  it('rejects a grouped label whose hook has no outputGroup', async () => {
    hookState.hooks = [hooks[0], hookWith('tvl-c')] as typeof hooks
    await expect(new TimeseriesExtractor().extract({ ...DATA, ...grouped })).rejects.toThrow('!compatible output group, tvl-c')
  })

  it('rejects mismatched output groups', async () => {
    const other = { key: 'yearn-tvl', labels: ['tvl', 'tvl-c'], process: vi.fn() }
    hookState.hooks = [hooks[0], hookWith('tvl-c', other)] as typeof hooks
    await expect(new TimeseriesExtractor().extract({ ...DATA, ...grouped })).rejects.toThrow('incompatible output group')
    expect(processGroup).not.toHaveBeenCalled()
  })

  it('rejects a processor output with an unrequested label', async () => {
    processGroup.mockResolvedValue([output('other')])
    await expect(new TimeseriesExtractor().extract({ ...DATA, ...grouped })).rejects.toThrow('outside the request')
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('rejects a processor output with the wrong blockTime', async () => {
    processGroup.mockResolvedValue([output('tvl', 1n)])
    await expect(new TimeseriesExtractor().extract({ ...DATA, ...grouped })).rejects.toThrow('outside the request')
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('accepts fewer outputs than requested labels', async () => {
    processGroup.mockResolvedValue([output('tvl')])
    await new TimeseriesExtractor().extract({ ...DATA, ...grouped })
    expect(mqAdd).toHaveBeenCalledTimes(1)
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
