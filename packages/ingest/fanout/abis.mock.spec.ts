import { beforeEach, describe, expect, it, vi } from 'vitest'

const { config, getThings, gaugeMetric, busy, add } = vi.hoisted(() => ({
  config: { abis: [] as { abiPath: string, sources: object[], things?: object }[] },
  getThings: vi.fn(), gaugeMetric: vi.fn(), busy: vi.fn(), add: vi.fn()
}))
vi.mock('lib', () => ({
  abisConfig: config, chains: [{ id: 1 }], sentry: { gaugeMetric, captureMessage: vi.fn() },
  mq: { add, job: { extract: { manuals: {}, snapshot: {} }, fanout: { events: {}, timeseries: {} } } }
}))
vi.mock('../things', () => ({ get: getThings }))
vi.mock('../prices', () => ({ clearNegativePriceCache: vi.fn() }))
vi.mock('./isBusy', () => ({ findBusyMatch: busy }))
vi.mock('./webhooks', () => ({ default: class { collect = vi.fn(); flush = vi.fn() } }))
import AbisFanout from './abis'

const source = { chainId: 1, address: '0x0000000000000000000000000000000000000001', inceptBlock: 1n }

describe('ABI reader overlap alert', () => {
  beforeEach(() => { vi.clearAllMocks(); config.abis = []; getThings.mockResolvedValue([]); busy.mockResolvedValue(undefined) })
  it('reports one address with two distinct readers once', async () => {
    config.abis = ['erc4626', 'yearn/3/vault'].map(abiPath => ({ abiPath, sources: [source] }))
    await new AbisFanout().fanout({})
    expect(gaugeMetric).toHaveBeenCalledTimes(1)
    expect(gaugeMetric).toHaveBeenCalledWith('abi_reader_overlap.addresses', 1, { component: 'ingest' })
  })
  it('records the current gauge even when the busy guard skips enqueueing', async () => {
    config.abis = ['erc4626', 'yearn/3/vault'].map(abiPath => ({ abiPath, sources: [source] }))
    busy.mockResolvedValue({ queue: 'load', jobName: 'output', status: 'active' })
    await new AbisFanout().fanout({})
    expect(gaugeMetric).toHaveBeenCalledWith('abi_reader_overlap.addresses', 1, { component: 'ingest' })
    expect(add).not.toHaveBeenCalled()
  })

  it('is silent for one reader', async () => {
    config.abis = [{ abiPath: 'yearn/3/vault', sources: [source] }]
    await new AbisFanout().fanout({})
    expect(gaugeMetric).toHaveBeenCalledWith('abi_reader_overlap.addresses', 0, { component: 'ingest' })
  })
  it('does not count a source plus thing using the same ABI as two readers', async () => {
    config.abis = [{ abiPath: 'yearn/3/vault', sources: [source], things: {} }]
    getThings.mockResolvedValue([{ ...source, defaults: { inceptBlock: 1n } }])
    await new AbisFanout().fanout({})
    expect(gaugeMetric).toHaveBeenCalledWith('abi_reader_overlap.addresses', 0, { component: 'ingest' })
  })
})
