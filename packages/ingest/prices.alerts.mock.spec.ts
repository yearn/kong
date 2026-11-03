import { beforeEach, describe, expect, it, vi } from 'vitest'

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }))
vi.mock('lib/sentry', () => ({ captureMessage, captureException: vi.fn(), flush: vi.fn() }))

import { reportPriceServiceBatchFailure, resetPriceServiceAlertsForTest, trackPriceServiceMiss } from './prices'

const HOUR = 60 * 60 * 1000
const T0 = 1793664000000

describe('price service alerts', () => {
  beforeEach(() => { captureMessage.mockReset(); resetPriceServiceAlertsForTest() })

  it('reports a miss spike once per chain per hour', () => {
    for (let i = 0; i < 400; i++) trackPriceServiceMiss(1, `0x${i.toString(16).padStart(40, '0')}`, T0)
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage.mock.calls[0][0]).to.equal('PRICE_SERVICE_MISS_SPIKE')
    for (let i = 0; i < 400; i++) trackPriceServiceMiss(1, `0x${i.toString(16).padStart(40, '0')}`, T0 + HOUR)
    expect(captureMessage).toHaveBeenCalledTimes(2)
  })

  it('ignores repeated misses for the same few tokens', () => {
    for (let i = 0; i < 1000; i++) trackPriceServiceMiss(10, '0xabc', T0)
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('reports batch failures at most once per hour without the url', () => {
    reportPriceServiceBatchFailure(3, new Error('batchHistorical 500 https://prices.yearn.dev/x?coins=1'), T0)
    reportPriceServiceBatchFailure(3, new Error('batchHistorical 500'), T0 + 1000)
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage.mock.calls[0][1].extra.error).to.equal('batchHistorical 500')
    reportPriceServiceBatchFailure(1, new Error('x'), T0 + HOUR)
    expect(captureMessage).toHaveBeenCalledTimes(2)
  })
})
