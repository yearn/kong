import { beforeEach, describe, expect, it, vi } from 'vitest'

const { config, getThings, captureMessage } = vi.hoisted(() => ({
  config: { abis: [] as { abiPath: string, sources: object[], things?: object }[] },
  getThings: vi.fn(), captureMessage: vi.fn()
}))
vi.mock('lib', () => ({
  abisConfig: config, chains: [{ id: 1 }], sentry: { captureMessage },
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
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith('ABI_READER_OVERLAP', expect.objectContaining({
      extra: { count: 1, sample: { [`1-${source.address}`]: ['erc4626', 'yearn/3/vault'] } }
    }))
  })
  it('is silent for one reader', async () => {
    config.abis = [{ abiPath: 'yearn/3/vault', sources: [source] }]
    await new AbisFanout().fanout({})
    expect(captureMessage).not.toHaveBeenCalled()
  })
  it('does not count a source plus thing using the same ABI as two readers', async () => {
    config.abis = [{ abiPath: 'yearn/3/vault', sources: [source], things: {} }]
    getThings.mockResolvedValue([{ ...source, defaults: { inceptBlock: 1n } }])
    await new AbisFanout().fanout({})
    expect(captureMessage).not.toHaveBeenCalled()
  })
})
