import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getBlock, estimateHeight, estimateHeightAtOrBefore } = vi.hoisted(() => ({
  getBlock: vi.fn(async () => ({ chainId: 1, number: 123n, timestamp: 1_704_153_599n })),
  estimateHeight: vi.fn(async () => 77n),
  estimateHeightAtOrBefore: vi.fn(async () => 66n)
}))

vi.mock('lib/blocks', () => ({ getBlock, estimateHeight, estimateHeightAtOrBefore }))

import { endOfStringDay, epoch } from 'lib/dates'
import { resolveTimeseriesBlock } from './timeseries-block'

describe('resolveTimeseriesBlock', () => {
  beforeEach(() => {
    getBlock.mockClear()
    estimateHeight.mockClear()
    estimateHeightAtOrBefore.mockClear()
  })

  it('uses the live head for an open daily request, even when the head timestamp is stale', async () => {
    const openDay = endOfStringDay('2024-01-03')
    getBlock.mockResolvedValueOnce({ chainId: 1, number: 9n, timestamp: endOfStringDay('2024-01-02') })

    await expect(resolveTimeseriesBlock(1, { blockTime: openDay, isClosedDay: false })).resolves.toBe(9n)

    expect(getBlock).toHaveBeenCalledWith(1)
    expect(estimateHeight).not.toHaveBeenCalled()
    expect(estimateHeightAtOrBefore).not.toHaveBeenCalled()
  })

  it('keeps source timestamps for direct callers with separate series metadata', async () => {
    const sourceBlockTime = epoch('2024-01-01T12:34:56Z')
    const requestedDay = endOfStringDay('2024-01-01')

    await expect(resolveTimeseriesBlock(1, {
      blockTime: sourceBlockTime,
      seriesTime: requestedDay,
      isClosedDay: true
    })).resolves.toBe(77n)

    expect(estimateHeight).toHaveBeenCalledWith(1, sourceBlockTime)
    expect(estimateHeightAtOrBefore).not.toHaveBeenCalled()
  })

  it('uses the last-at-or-before resolver for a closed daily grid request', async () => {
    const day = endOfStringDay('2024-01-01')

    await expect(resolveTimeseriesBlock(1, {
      blockTime: day,
      isClosedDay: true
    })).resolves.toBe(66n)

    expect(estimateHeightAtOrBefore).toHaveBeenCalledWith(1, day)
    expect(estimateHeight).not.toHaveBeenCalled()
  })
})
