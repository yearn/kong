import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryMock, mqAdd, batchxMock, usePriceServiceMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  mqAdd: vi.fn(),
  batchxMock: vi.fn(),
  usePriceServiceMock: vi.fn()
}))

vi.mock('pg', () => ({ Pool: class { query = queryMock } }))
vi.mock('bullmq', () => ({ Queue: class {} }))
vi.mock('lib', () => ({ mq: { add: mqAdd, job: { load: { price: { name: 'price' } } } } }))
vi.mock('lib/batchx', () => ({ default: batchxMock }))
vi.mock('lib/processor', () => ({}))
vi.mock('lib/types', () => ({ PriceSchema: { parse: (x: unknown) => x } }))
vi.mock('../prices', () => ({ usePriceService: usePriceServiceMock }))

import { WaveyDbExtractor } from './waveydb'

describe('WaveyDbExtractor.extractPrices (USE_PRICE_SERVICE gate)', () => {
  beforeEach(() => {
    queryMock.mockReset()
    mqAdd.mockReset()
    batchxMock.mockReset()
    usePriceServiceMock.mockReset()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('skips all price-table reads/writes in service mode', async () => {
    usePriceServiceMock.mockReturnValue(true)

    await new WaveyDbExtractor().extractPrices()

    expect(queryMock).not.toHaveBeenCalled()
    expect(mqAdd).not.toHaveBeenCalled()
    expect(batchxMock).not.toHaveBeenCalled()
  })

  it('reads the reports table in legacy mode', async () => {
    usePriceServiceMock.mockReturnValue(false)
    queryMock.mockResolvedValue({ rows: [] })

    await new WaveyDbExtractor().extractPrices()

    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
