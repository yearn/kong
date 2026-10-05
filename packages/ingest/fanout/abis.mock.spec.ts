import { beforeEach, describe, expect, it, vi } from 'vitest'

const { config, getThings, countMetric } = vi.hoisted(() => ({
  config: { abis: [] as { abiPath: string, sources: object[], things?: object }[] },
  getThings: vi.fn(), countMetric: vi.fn()
}))
vi.mock('lib', () => ({
  abisConfig: config, chains: [{ id: 1 }], sentry: { countMetric },
  mq: { add: vi.fn(), job: { extract: { manuals: {}, snapshot: {} }, fanout: { events: {}, timeseries: {} } } }
}))
vi.mock('../things', () => ({ get: getThings }))
vi.mock('../prices', () => ({ clearNegativePriceCache: vi.fn() }))
vi.mock('./isBusy', () => ({ findBusyMatch: async () => undefined }))
vi.mock('./webhooks', () => ({ default: class { collect = vi.fn(); flush = vi.fn() } }))
import AbisFanout from './abis'

const source = { chainId: 1, address: '0x0000000000000000000000000000000000000001', inceptBlock: 1n }

describe('ABI reader overlap alert', () => {
  beforeEach(() => { vi.clearAllMocks(); config.abis = []; getThings.mockResolvedValue([]) })
  it('reports one address with two distinct readers once', async () => {
    config.abis = ['erc4626', 'yearn/3/vault'].map(abiPath => ({ abiPath, sources: [source] }))
    await new AbisFanout().fanout({})
    expect(countMetric).toHaveBeenCalledTimes(1)
    expect(countMetric).toHaveBeenCalledWith('abi_reader_overlap.addresses', 1, { component: 'ingest' })
  })
  it('is silent for one reader', async () => {
    config.abis = [{ abiPath: 'yearn/3/vault', sources: [source] }]
    await new AbisFanout().fanout({})
    expect(countMetric).toHaveBeenCalledWith('abi_reader_overlap.addresses', 0, { component: 'ingest' })
  })
  it('does not count a source plus thing using the same ABI as two readers', async () => {
    config.abis = [{ abiPath: 'yearn/3/vault', sources: [source], things: {} }]
    getThings.mockResolvedValue([{ ...source, defaults: { inceptBlock: 1n } }])
    await new AbisFanout().fanout({})
    expect(countMetric).toHaveBeenCalledWith('abi_reader_overlap.addresses', 0, { component: 'ingest' })
  })
})
