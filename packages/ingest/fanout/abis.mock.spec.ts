import { beforeEach, describe, expect, it, vi } from 'vitest'

const { add, clearApr, clearPrices, findBusyMatch, captureMessage } = vi.hoisted(() => ({
  add: vi.fn(),
  clearApr: vi.fn(),
  clearPrices: vi.fn(),
  findBusyMatch: vi.fn(),
  captureMessage: vi.fn(),
}))

vi.mock('lib', () => ({
  abisConfig: { abis: [] },
  chains: [],
  mq: { add, job: { extract: { manuals: 'manuals' } } },
  sentry: { captureMessage },
}))
vi.mock('../things', () => ({ get: vi.fn() }))
vi.mock('../prices', () => ({ clearNegativePriceCache: clearPrices }))
vi.mock('../abis/yearn/3/vault/timeseries/apr-oracle/hook', () => ({ clearNegativeAprOracleCache: clearApr }))
vi.mock('./isBusy', () => ({ findBusyMatch }))
vi.mock('./webhooks', () => ({ default: class WebhookCollector { async flush() {} } }))

import AbisFanout from './abis'

describe('ABI replay cache invalidation', () => {
  beforeEach(() => {
    add.mockReset()
    clearApr.mockReset().mockResolvedValue(undefined)
    clearPrices.mockReset().mockResolvedValue(undefined)
    findBusyMatch.mockReset().mockResolvedValue(undefined)
    captureMessage.mockReset()
  })

  it('clears both price and historical APR negative caches before replay fanout', async () => {
    await new AbisFanout().fanout({ replay: { enabled: true } })

    expect(clearPrices).toHaveBeenCalledOnce()
    expect(clearApr).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledWith('manuals', { replay: { enabled: true } })
  })
})
